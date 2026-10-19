
import os
from typing import Optional, Generator

from dotenv import load_dotenv
from sqlalchemy import (
    create_engine,
    text,
)
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# Load environment variables from .env
load_dotenv()

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in the environment.")

# Create SQLAlchemy engine
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# Base class for SQLAlchemy models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """Provide a database session and close it after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_feedback_database(db: Session) -> None:
    """Create the molecule_feedback table if it does not exist."""
    create_table_query = text("""
        CREATE TABLE IF NOT EXISTS molecule_feedback (
            id SERIAL PRIMARY KEY,
            molecule_id INT NOT NULL
                REFERENCES generated_molecules(id)
                ON DELETE CASCADE,
            rating_type VARCHAR(20) NOT NULL
                CHECK (rating_type IN ('thumbs_up', 'thumbs_down', 'star')),
            rating_value INT NOT NULL,
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK (
                (rating_type = 'thumbs_up' AND rating_value = 1)
                OR (rating_type = 'thumbs_down' AND rating_value = 0)
                OR (rating_type = 'star' AND rating_value BETWEEN 1 AND 5)
            )
        );
    """)

    try:
        db.execute(create_table_query)
        db.commit()
        print("PostgreSQL: molecule_feedback table initialized.")
    except Exception:
        db.rollback()
        raise


def save_molecule_feedback(
    db: Session,
    molecule_id: int,
    rating_type: str,
    rating_value: int,
    comment: Optional[str] = None,
) -> dict:
    """Insert feedback and return its generated ID."""

    insert_query = text("""
        INSERT INTO molecule_feedback (
            molecule_id,
            rating_type,
            rating_value,
            comment
        )
        VALUES (
            :molecule_id,
            :rating_type,
            :rating_value,
            :comment
        )
        RETURNING id;
    """)

    try:
        result = db.execute(
            insert_query,
            {
                "molecule_id": molecule_id,
                "rating_type": rating_type,
                "rating_value": rating_value,
                "comment": comment,
            },
        )

        feedback_id = result.scalar_one()
        db.commit()

        return {
            "status": "success",
            "feedback_id": feedback_id,
        }

    except Exception as e:
        db.rollback()
        print(f"PostgreSQL Save Error: {e}")

        return {
            "status": "error",
            "message": str(e),
        }
