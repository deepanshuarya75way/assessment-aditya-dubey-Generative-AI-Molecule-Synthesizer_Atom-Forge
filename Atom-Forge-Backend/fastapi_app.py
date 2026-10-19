# fastapi_app.py
"""
FastAPI app for multi-property molecular generation.

Endpoints:
    GET  /                    — health check
    POST /generate            — generate molecules (requires X-User-Id header)
    GET  /history/{user_id}   — a user's past generation runs
    POST /feedback            — submit molecule or general feedback (requires X-User-Id header)

Usage:
    uvicorn fastapi_app:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import base64
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Literal, Optional

import httpx
import joblib
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import Feedback, GenerationHistory, ensure_user, get_db, init_db
from generate import load_vae, load_gnn
from utils.chemistry import (
    PROPERTY_NAMES,
    molecule_to_image_bytes,
    smiles_to_3d_sdf,
)
from utils.naming import get_molecule_names_async, get_molecule_names
from utils.optimization import optimize_latent_space


@lru_cache(maxsize=512)
def cached_molecule_names(smiles):
    """
    Cache naming results so repeated SMILES
    don't trigger redundant API calls.
    """
    return get_molecule_names(smiles)


# -------------------------------------------------------
# Global model registry
# -------------------------------------------------------
_models = {}


# -------------------------------------------------------
# Lifespan — load models and set up the database once at startup
# -------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Loading models...")

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    try:
        vae_model, idx_to_token = load_vae(device)
        gnn_model = load_gnn(device)
        scaler = joblib.load("gnn_scaler.pkl")
    except FileNotFoundError as e:
        raise RuntimeError(
            f"Model file not found: {e}\n"
            "Please run train_vae.py and train_gnn.py first."
        )

    _models["device"] = device
    _models["vae"] = vae_model
    _models["gnn"] = gnn_model
    _models["scaler"] = scaler
    _models["idx_to_token"] = idx_to_token

    _models["http_client"] = httpx.AsyncClient(
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=10,
        ),
        timeout=10.0,
    )

    # Create database tables if they don't exist yet
    init_db()

    print("All models loaded and ready.")

    yield

    # cleanup
    await _models["http_client"].aclose()
    _models.clear()

    print("Models unloaded.")


# -------------------------------------------------------
# Helper — compute accuracy percentage
# -------------------------------------------------------
def compute_accuracy(predicted, target):
    """
    How close the predicted value is to the target,
    expressed as a percentage.

    Uses relative error when target is non-zero,
    falls back to absolute error when target is near zero.
    """
    if abs(target) < 1e-6:
        # target is near zero — use absolute error
        accuracy = max(0.0, 100.0 - abs(predicted - target) * 100)
    else:
        accuracy = max(
            0.0,
            (1 - abs(predicted - target) / abs(target)) * 100
        )
    return round(accuracy, 2)


# -------------------------------------------------------
# App
# -------------------------------------------------------
app = FastAPI(
    title="Molecule Designer API",
    description=(
        "Generate drug-like molecules targeting "
        "a desired molecular property using "
        "a SELFIES VAE + Graph Attention Network."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # your Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],   # allows the X-User-Id header
)


# -------------------------------------------------------
# Schemas
# -------------------------------------------------------
class GenerateRequest(BaseModel):
    property: str = Field(
        default="QED",
        description=(
            f"Molecular property to optimize. "
            f"Choices: {PROPERTY_NAMES}"
        ),
    )
    target: float = Field(
        description="Desired target value for the property.",
    )
    num_random: int = Field(
        default=500,
        ge=100,
        le=5000,
        description="Number of random latent samples (Phase 1).",
    )
    num_local: int = Field(
        default=500,
        ge=100,
        le=5000,
        description="Number of local refinement samples (Phase 2).",
    )
    noise_scale: float = Field(
        default=0.3,
        ge=0.1,
        le=1.0,
        description="Noise scale for local refinement.",
    )
    top_k_seeds: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Number of top candidates used as seeds in Phase 2.",
    )
    top_images: int = Field(
        default=3,
        ge=0,
        le=10,
        description=(
            "Number of top molecules to generate images for. "
            "Set to 0 to skip all images."
        ),
    )


class MoleculeResult(BaseModel):
    # Identity
    smiles:           str
    name:             str
    systematic_name:  str
    iupac_name:       str
    common_name:      str
    formula:          str
    inchi:            Optional[str] = None

    # Scores
    selected_property:    str
    predicted_property:   float
    target_property:      float
    error:                float
    accuracy:             float

    # Image — None if not requested
    image_base64: Optional[str] = None
    mol_3d_sdf:   Optional[str] = None


class GenerateResponse(BaseModel):
    property:          str
    target:            float
    total_candidates:  int
    molecules:         list[MoleculeResult]


class FeedbackRequest(BaseModel):
    kind: Literal["molecule", "general"]
    rating: Optional[Literal[1, -1]] = None   # 1 = thumbs up, -1 = thumbs down
    smiles: Optional[str] = Field(default=None, max_length=512)
    comment: Optional[str] = Field(default=None, max_length=2000)


# -------------------------------------------------------
# Helper — SMILES to base64 PNG
# -------------------------------------------------------
def smiles_to_base64_image(smiles):
    img_bytes = molecule_to_image_bytes(smiles, size=(300, 300))
    if img_bytes is None:
        return None
    return base64.b64encode(img_bytes).decode("utf-8")


# -------------------------------------------------------
# Routes
# -------------------------------------------------------
@app.get("/", summary="Health check")
def root():
    return {
        "status":     "ok",
        "properties": PROPERTY_NAMES,
        "device":     str(_models.get("device", "not loaded")),
    }


@app.post("/generate", response_model=GenerateResponse)
async def generate(
    request: GenerateRequest,
    x_user_id: str = Header(...),
    db: Session = Depends(get_db),
):

    if request.property not in PROPERTY_NAMES:
        raise HTTPException(status_code=422, detail=(
            f"Unknown property '{request.property}'. "
            f"Choose from: {PROPERTY_NAMES}"
        ))

    device       = _models["device"]
    vae_model    = _models["vae"]
    gnn_model    = _models["gnn"]
    scaler       = _models["scaler"]
    idx_to_token = _models["idx_to_token"]
    http_client  = _models["http_client"]

    # Optimization runs in thread (it's CPU/GPU bound)
    results = await asyncio.to_thread(
        optimize_latent_space,
        vae_model=vae_model,
        gnn_model=gnn_model,
        scaler=scaler,
        idx_to_token=idx_to_token,
        target_property=request.target,
        selected_property=request.property,
        num_random=request.num_random,
        num_local=request.num_local,
        top_k_seeds=request.top_k_seeds,
        noise_scale=request.noise_scale,
        device=device,
    )

    if not results:
        raise HTTPException(status_code=404, detail=(
            "No valid molecules generated. "
            "Try increasing num_random or num_local."
        ))

    async def process_molecule(i, r):
        wants_visuals = i < request.top_images

        # Name lookup (async, shared client)
        name_task = get_molecule_names_async(
            r["smiles"], http_client
        )

        # 3D SDF generation (CPU bound → thread)
        sdf_task = (
            asyncio.to_thread(smiles_to_3d_sdf, r["smiles"])
            if wants_visuals
            else asyncio.sleep(0, result=None)
        )

        # 2D image (CPU bound → thread)
        img_task = (
            asyncio.to_thread(smiles_to_base64_image, r["smiles"])
            if wants_visuals
            else asyncio.sleep(0, result=None)
        )

        # All three run at the same time
        name_info, sdf_3d, image_b64 = await asyncio.gather(
            name_task,
            sdf_task,
            img_task,
        )

        return MoleculeResult(
            smiles=r["smiles"],
            name=name_info["name"],
            systematic_name=name_info["systematic_name"],
            iupac_name=name_info["iupac_name"],
            common_name=name_info["common_name"],
            formula=name_info["formula"],
            inchi=name_info["inchi"],
            selected_property=r["selected_property"],
            predicted_property=r["predicted_property"],
            target_property=r["target_property"],
            error=r["error"],
            accuracy=compute_accuracy(
                r["predicted_property"],
                r["target_property"],
            ),
            image_base64=image_b64,
            mol_3d_sdf=sdf_3d,
        )

    # All molecules processed in parallel
    molecules = await asyncio.gather(*[
        process_molecule(i, r)
        for i, r in enumerate(results)
    ])

    response = GenerateResponse(
        property=request.property,
        target=request.target,
        total_candidates=len(molecules),
        molecules=list(molecules),
    )

    # Save this run to the user's history (images and 3D data excluded)
    ensure_user(db, x_user_id)
    db.add(GenerationHistory(
        user_id=x_user_id,
        property=request.property,
        target=request.target,
        total_candidates=response.total_candidates,
        results=[
            m.model_dump(exclude={"image_base64", "mol_3d_sdf"})
            for m in response.molecules
        ],
    ))
    db.commit()

    return response


@app.get("/history/{user_id}", summary="Past generation runs for a user")
def get_history(user_id: str, limit: int = 20, db: Session = Depends(get_db)):
    rows = (
        db.query(GenerationHistory)
          .filter_by(user_id=user_id)
          .order_by(GenerationHistory.created_at.desc())
          .limit(limit)
          .all()
    )
    return [
        {
            "id":               r.id,
            "property":         r.property,
            "target":           r.target,
            "total_candidates": r.total_candidates,
            "created_at":       r.created_at.isoformat(),
            "molecules":        r.results,
        }
        for r in rows
    ]


@app.post("/feedback", status_code=201, summary="Submit feedback")
def submit_feedback(
    payload: FeedbackRequest,
    x_user_id: str = Header(...),
    db: Session = Depends(get_db),
):
    comment = payload.comment.strip() if payload.comment else None

    if payload.kind == "molecule":
        if not payload.smiles or payload.rating is None:
            raise HTTPException(
                status_code=422,
                detail="Molecule feedback needs a smiles value and a rating.",
            )
    else:  # general
        if payload.rating is None and not comment:
            raise HTTPException(
                status_code=422,
                detail="General feedback needs a rating or a comment.",
            )

    ensure_user(db, x_user_id)
    db.add(Feedback(
        user_id=x_user_id,
        kind=payload.kind,
        smiles=payload.smiles if payload.kind == "molecule" else None,
        rating=payload.rating,
        comment=comment,
    ))
    db.commit()
    return {"status": "saved"}