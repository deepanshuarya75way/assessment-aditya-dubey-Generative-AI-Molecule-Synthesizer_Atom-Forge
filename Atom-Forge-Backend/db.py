# db.py
import os
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import (create_engine, String, Float, Integer, Text,
                        DateTime, JSON, ForeignKey)
from sqlalchemy.orm import (DeclarativeBase, Mapped, mapped_column,
                            sessionmaker, Session)

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Add it to Atom-Forge-Backend/.env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class GenerationHistory(Base):
    __tablename__ = "generation_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    property: Mapped[str] = mapped_column(String(32))
    target: Mapped[float] = mapped_column(Float)
    total_candidates: Mapped[int] = mapped_column(Integer)
    results: Mapped[list] = mapped_column(JSON)  # smiles + names only, no images
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))           # "molecule" or "general"
    smiles: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1 = up, -1 = down
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def init_db():
    Base.metadata.create_all(engine)  # creates any missing tables


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_user(db: Session, user_id: str):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.commit()