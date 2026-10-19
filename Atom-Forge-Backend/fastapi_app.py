# fastapi_app.py
"""
FastAPI app for multi-property molecular generation.

Endpoints:
    GET  /          — health check
    POST /generate  — generate molecules targeting a property

Usage:
    uvicorn fastapi_app:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import base64
from contextlib import asynccontextmanager
from typing import Optional
import httpx
import joblib
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from generate import load_vae, load_gnn
from utils.chemistry import (
    PROPERTY_NAMES,
    molecule_to_image_bytes,
)
from utils.naming import get_molecule_names_async, get_molecule_names
from utils.optimization import optimize_latent_space

from utils.chemistry import (
    PROPERTY_NAMES,
    molecule_to_image_bytes,
    smiles_to_3d_sdf,  # ← add this
)

from functools import lru_cache


@lru_cache(maxsize=512)
def cached_molecule_names(smiles):
    """
    Cache naming results so repeated SMILES
    don't trigger redundant API calls.
    """
    return get_molecule_names(smiles)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Loading models...")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

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

    # ADD THIS
    _models["http_client"] = httpx.AsyncClient(
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=10,
        ),
        timeout=10.0,
    )

    print("All models loaded and ready.")

    yield

    # cleanup
    await _models["http_client"].aclose()
    _models.clear()

    print("Models unloaded.")


# -------------------------------------------------------
# Global model registry
# -------------------------------------------------------
_models = {}

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
import logging

app = FastAPI()
logger = logging.getLogger(__name__)

# Assumes 'db' is your asyncpg connection pool created elsewhere in your app
# e.g., db = await asyncpg.create_pool(dsn)
db: asyncpg.Pool = None

# Define the request body schema using Pydantic
class FeedbackRequest(BaseModel):
    molecule_id: int
    rating: int = Field(..., ge=1, le=5)  # Example validation: rating between 1 and 5
    comment: Optional[str] = None


@app.post("/api/feedback", status_code=status.HTTP_201_CREATED)
async def create_feedback(payload: FeedbackRequest):
    # Extract data from the validated payload
    molecule_id = payload.molecule_id
    rating = payload.rating
    comment = payload.comment

    try:
        # FastAPI/asyncpg uses $1, $2 placeholder style just like pg in Node.js
        query = """
            INSERT INTO molecule_feedback (molecule_id, rating, comment) 
            VALUES ($1, $2, $3) RETURNING *;
        """

        # Execute the query and fetch the first returned row
        row = await db.fetchrow(query, molecule_id, rating, comment)

        # asyncpg rows can be converted directly into standard dictionaries
        return {"success": True, "data": dict(row)}

    except Exception as err:
        logger.error(err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server error saving feedback",
        )


from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

import logging

app = FastAPI()
logger = logging.getLogger(__name__)
db: asyncpg.Pool = None   

# 1. Update this Pydantic model to match your frontend payload keys exactly
class GenerateRequest(BaseModel):
    property: str
    target: float  # Matches Number(targetValue)
    num_random: int  # Matches Math.floor(numSamples / 2)
    num_local: int  # Matches Math.floor(numSamples / 2)
    top_images: int  # Matches 10


# 2. Update the route path to match your fetch URL endpoint
@app.post("/generate", status_code=status.HTTP_201_CREATED)
async def generate_molecules(payload: GenerateRequest):
    try:
        # Example processing using the frontend keys
        # Replace this query with whatever logic/table fits your generator
        query = """
            INSERT INTO generation_logs (property, target, num_random, num_local, top_images) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *;
        """

        row = await db.fetchrow(
            query,
            payload.property,
            payload.target,
            payload.num_random,
            payload.num_local,
            payload.top_images,
        )

        return {"success": True, "data": dict(row)}

    except Exception as err:
        logger.error(err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server error generating data",
        )


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
        accuracy = max(0.0, (1 - abs(predicted - target) / abs(target)) * 100)
    return round(accuracy, 2)


# -------------------------------------------------------
# Lifespan — load models once at startup
# -------------------------------------------------------


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

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # your Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# -------------------------------------------------------
# Schemas
# -------------------------------------------------------
class GenerateRequest(BaseModel):
    property: str = Field(
        default="QED",
        description=(f"Molecular property to optimize. " f"Choices: {PROPERTY_NAMES}"),
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
    smiles: str
    name: str
    systematic_name: str
    iupac_name: str
    common_name: str
    formula: str
    inchi: Optional[str] = None

    # Scores
    selected_property: str
    predicted_property: float
    target_property: float
    error: float
    accuracy: float

    # Image — None if not requested
    image_base64: Optional[str] = None
    mol_3d_sdf: Optional[str] = None


class GenerateResponse(BaseModel):
    property: str
    target: float
    total_candidates: int
    molecules: list[MoleculeResult]


@app.get("/api/users/{customer_id}/history")
def get_user_history(customer_id: int):
    query = """
        SELECT id, input_parameters, smiles_data, created_at 
        FROM generated_molecules 
        WHERE customer_id = %s 
        ORDER BY created_at DESC;
    """
    db.execute(query, (customer_id,))
    history = db.fetchall()  # Returns a list of past generations
    return {"history": history}


# -------------------------------------------------------
# Helper — SMILES to base64 PNG
# -------------------------------------------------------
def smiles_to_base64_image(smiles):
    img_bytes = molecule_to_image_bytes(smiles, size=(300, 300))
    if img_bytes is None:
        return None
    return base64.b64encode(img_bytes).decode("utf-8")


from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from db import get_db   # Assumes you have a Feedback model built

app = FastAPI()


@app.post("/api/feedback")
def create_feedback(
    molecule_id: int, rating: int, comment: str, db: Session = Depends(get_db)
):
    # Create a new record object
    new_feedback = FeedbackModel(
        molecule_id=molecule_id, rating=rating, comment=comment
    )

    # Save it to PostgreSQL
    db.add(new_feedback)
    db.commit()
    db.refresh(new_feedback)

    return {"success": True, "data": new_feedback.id}


from db import engine, Base
import models

# This command physically builds the tables in your PostgreSQL database
Base.metadata.create_all(bind=engine)

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from db import get_db
from models import MoleculeFeedback

app = FastAPI()

# 1. Define what data the frontend must submit
class FeedbackCreate(BaseModel):
    molecule_id: int
    rating: int
    comment: str = None


# 2. Create the API endpoint
@app.post("/api/feedback")
def submit_molecule_feedback(payload: FeedbackCreate, db: Session = Depends(get_db)):
    # Validate the rating scope
    if payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    # Create the new entry record
    new_entry = MoleculeFeedback(
        molecule_id=payload.molecule_id, rating=payload.rating, comment=payload.comment
    )

    # Save the entry safely into PostgreSQL
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)

    return {"status": "success", "message": "Feedback saved!", "id": new_entry.id}


# -------------------------------------------------------
# Routes
# -------------------------------------------------------
@app.get("/", summary="Health check")
def root():
    return {
        "status": "ok",
        "properties": PROPERTY_NAMES,
        "device": str(_models.get("device", "not loaded")),
    }


@app.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):

    if request.property not in PROPERTY_NAMES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unknown property '{request.property}'. "
                f"Choose from: {PROPERTY_NAMES}"
            ),
        )

    device = _models["device"]
    vae_model = _models["vae"]
    gnn_model = _models["gnn"]
    scaler = _models["scaler"]
    idx_to_token = _models["idx_to_token"]
    http_client = _models["http_client"]

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
        raise HTTPException(
            status_code=404,
            detail=(
                "No valid molecules generated. "
                "Try increasing num_random or num_local."
            ),
        )

    async def process_molecule(i, r):
        wants_visuals = i < request.top_images

        # Name lookup (async, shared client)
        name_task = get_molecule_names_async(r["smiles"], http_client)

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

    # Example for FastAPI / Flask workflow


@app.post("/api/molecules/generate")
def generate_and_save_molecule(data: dict):
    customer_id = data.get("customer_id")
    input_values = data.get("input_parameters")  # e.g., {"weight": 300, "logP": 2.1}

    # 1. Run your existing AI generation logic here
    generated_smiles = run_ai_model(input_values)

    # 2. Save the result to your PostgreSQL history table
    query = """
        INSERT INTO generated_molecules (customer_id, input_parameters, smiles_data)
        VALUES (%s, %s, %s) RETURNING id;
    """
    # Convert input_values dictionary to a JSON string for Postgres JSONB
    import json

    db.execute(query, (customer_id, json.dumps(input_values), generated_smiles))
    db_connection.commit()

    # 3. Return the molecule to the front end
    return {"status": "success", "smiles": generated_smiles, "customer_id": customer_id}

    # All molecules processed in parallel
    molecules = await asyncio.gather(
        *[process_molecule(i, r) for i, r in enumerate(results)]
    )

    return GenerateResponse(
        property=request.property,
        target=request.target,
        total_candidates=len(molecules),
        molecules=list(molecules),
    )
