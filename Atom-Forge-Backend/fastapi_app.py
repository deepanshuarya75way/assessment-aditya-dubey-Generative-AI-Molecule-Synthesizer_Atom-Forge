"""
FastAPI application for molecular generation and feedback.

Endpoints:
    GET  /                         Health check
    POST /generate                 Generate molecules
    POST /api/feedback             Save molecule feedback
    GET  /api/users/{customer_id}/history
                                    Retrieve generation history

Run:
    uvicorn fastapi_app:app --reload --host 0.0.0.0 --port 8000
"""

import asyncio
import base64
import logging
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import joblib
import torch

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db import get_db
from generate import load_vae, load_gnn
from db_manage import MoleculeFeedback

from utils.chemistry import (
    PROPERTY_NAMES,
    molecule_to_image_bytes,
    smiles_to_3d_sdf,
)
from utils.naming import get_molecule_names_async
from utils.optimization import optimize_latent_space


# -------------------------------------------------------
# Configuration
# -------------------------------------------------------

logger = logging.getLogger(__name__)

_models = {}


# -------------------------------------------------------
# Application lifespan: load models once at startup
# -------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading molecular generation models...")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    try:
        vae_model, idx_to_token = load_vae(device)
        gnn_model = load_gnn(device)
        scaler = joblib.load("gnn_scaler.pkl")

    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Required model file not found: {exc}. "
            "Train the models and ensure all model files "
            "are available before starting the API."
        ) from exc

    except Exception:
        logger.exception("Failed to load molecular generation models")
        raise

    _models.update(
        {
            "device": device,
            "vae": vae_model,
            "gnn": gnn_model,
            "scaler": scaler,
            "idx_to_token": idx_to_token,
            "http_client": httpx.AsyncClient(
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                ),
                timeout=10.0,
            ),
        }
    )

    logger.info("All models loaded successfully.")

    try:
        yield
    finally:
        client = _models.get("http_client")

        if client is not None:
            await client.aclose()

        _models.clear()
        logger.info("Models unloaded.")


# -------------------------------------------------------
# FastAPI application
# -------------------------------------------------------

app = FastAPI(
    title="Molecule Designer API",
    description=(
        "Generate molecules targeting desired molecular "
        "properties using a SELFIES VAE and Graph "
        "Attention Network."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your frontend URL in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------
# Request and response schemas
# -------------------------------------------------------


class GenerateRequest(BaseModel):
    property: str = Field(
        default="QED",
        description=f"Molecular property to optimize. Choices: {PROPERTY_NAMES}",
    )
    target: float = Field(description="Desired target value for the selected property.")
    num_random: int = Field(
        default=500,
        ge=100,
        le=5000,
        description="Number of random latent samples.",
    )
    num_local: int = Field(
        default=500,
        ge=100,
        le=5000,
        description="Number of local refinement samples.",
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
        description="Number of top candidates used as refinement seeds.",
    )
    top_images: int = Field(
        default=3,
        ge=0,
        le=10,
        description="Number of top molecules to generate visualizations for.",
    )


class MoleculeResult(BaseModel):
    smiles: str
    name: str
    systematic_name: str
    iupac_name: str
    common_name: str
    formula: str
    inchi: Optional[str] = None

    selected_property: str
    predicted_property: float
    target_property: float
    error: float
    accuracy: float

    image_base64: Optional[str] = None
    mol_3d_sdf: Optional[str] = None


class GenerateResponse(BaseModel):
    property: str
    target: float
    total_candidates: int
    molecules: list[MoleculeResult]


class FeedbackCreate(BaseModel):
    molecule_id: int
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


# -------------------------------------------------------
# Helpers
# -------------------------------------------------------


def compute_accuracy(predicted: float, target: float) -> float:
    """
    Return a percentage based on relative error.

    For targets close to zero, use absolute error instead.
    """
    if abs(target) < 1e-6:
        accuracy = max(
            0.0,
            100.0 - abs(predicted - target) * 100.0,
        )
    else:
        accuracy = max(
            0.0,
            (1.0 - abs(predicted - target) / abs(target)) * 100.0,
        )

    return round(accuracy, 2)


def smiles_to_base64_image(smiles: str) -> Optional[str]:
    """Convert a SMILES string to a base64-encoded PNG."""
    image_bytes = molecule_to_image_bytes(
        smiles,
        size=(300, 300),
    )

    if image_bytes is None:
        return None

    return base64.b64encode(image_bytes).decode("utf-8")


# -------------------------------------------------------
# Health check
# -------------------------------------------------------


@app.get("/", summary="Health check")
def root():
    return {
        "status": "ok",
        "properties": PROPERTY_NAMES,
        "device": str(_models.get("device", "not loaded")),
        "models_loaded": bool(_models),
    }


# -------------------------------------------------------
# Generate molecules
# -------------------------------------------------------


@app.post(
    "/generate",
    response_model=GenerateResponse,
)
async def generate(request: GenerateRequest):
    if request.property not in PROPERTY_NAMES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown property '{request.property}'. "
                f"Choose from: {PROPERTY_NAMES}"
            ),
        )

    if not _models:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Molecular generation models are not loaded.",
        )

    # Retrieve initialized models.
    device = _models["device"]
    vae_model = _models["vae"]
    gnn_model = _models["gnn"]
    scaler = _models["scaler"]
    idx_to_token = _models["idx_to_token"]
    http_client = _models["http_client"]

    # Run the computationally expensive optimization outside
    # the event loop.
    try:
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
    except Exception as exc:
        logger.exception("Molecule optimization failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Molecule optimization failed.",
        ) from exc

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No valid molecules generated. "
                "Try increasing num_random or num_local."
            ),
        )

    async def process_molecule(index: int, result: dict):
        wants_visuals = index < request.top_images

        # Retrieve chemical names asynchronously.
        name_task = get_molecule_names_async(
            result["smiles"],
            http_client,
        )

        # Generate 3D structure and 2D image concurrently.
        if wants_visuals:
            sdf_task = asyncio.to_thread(
                smiles_to_3d_sdf,
                result["smiles"],
            )
            image_task = asyncio.to_thread(
                smiles_to_base64_image,
                result["smiles"],
            )
        else:
            sdf_task = asyncio.sleep(0, result=None)
            image_task = asyncio.sleep(0, result=None)

        try:
            name_info, sdf_3d, image_b64 = await asyncio.gather(
                name_task,
                sdf_task,
                image_task,
            )
        except Exception:
            logger.exception(
                "Failed to enrich molecule at index %s",
                index,
            )
            raise

        return MoleculeResult(
            smiles=result["smiles"],
            name=name_info.get("name") or "Unknown",
            systematic_name=name_info.get("systematic_name") or "Unknown",
            iupac_name=name_info.get("iupac_name") or "Unknown",
            common_name=name_info.get("common_name") or "Unknown",
            formula=name_info.get("formula") or "Unknown",
            inchi=name_info.get("inchi"),
            selected_property=result["selected_property"],
            predicted_property=float(result["predicted_property"]),
            target_property=float(result["target_property"]),
            error=float(result["error"]),
            accuracy=compute_accuracy(
                float(result["predicted_property"]),
                float(result["target_property"]),
            ),
            image_base64=image_b64,
            mol_3d_sdf=sdf_3d,
        )

    # Process all generated candidates concurrently.
    try:
        molecules = await asyncio.gather(
            *[process_molecule(index, result) for index, result in enumerate(results)]
        )
    except Exception as exc:
        logger.exception("Failed to process generated molecules")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process generated molecules.",
        ) from exc

    return GenerateResponse(
        property=request.property,
        target=request.target,
        total_candidates=len(molecules),
        molecules=molecules,
    )


# -------------------------------------------------------
# Submit molecule feedback
# -------------------------------------------------------


@app.post(
    "/api/feedback",
    status_code=status.HTTP_201_CREATED,
)
def submit_molecule_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
):
    feedback = MoleculeFeedback(
        molecule_id=payload.molecule_id,
        rating=payload.rating,
        comment=payload.comment,
    )

    try:
        db.add(feedback)
        db.commit()
        db.refresh(feedback)

        return {
            "success": True,
            "message": "Feedback saved successfully.",
            "id": feedback.id,
        }

    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Failed to save molecule feedback")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server error saving feedback.",
        ) from exc


# -------------------------------------------------------
# Retrieve user generation history
# -------------------------------------------------------


@app.get("/api/users/{customer_id}/history")
def get_user_history(
    customer_id: int,
    db: Session = Depends(get_db),
):
    query = text(
        """
        SELECT id, input_parameters, smiles_data, created_at
        FROM generated_molecules
        WHERE customer_id = :customer_id
        ORDER BY created_at DESC
    """
    )

    try:
        rows = (
            db.execute(
                query,
                {"customer_id": customer_id},
            )
            .mappings()
            .all()
        )

        return {
            "customer_id": customer_id,
            "history": [dict(row) for row in rows],
        }

    except SQLAlchemyError as exc:
        logger.exception("Failed to retrieve generation history")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve generation history.",
        ) from exc
