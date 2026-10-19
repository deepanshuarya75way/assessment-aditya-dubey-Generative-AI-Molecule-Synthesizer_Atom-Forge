from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from datetime import datetime
from db import Base

class MoleculeFeedback(Base):
    __tablename__ = "molecule_feedback"

    id = Column(Integer, primary_key=True, index=True)
    molecule_id = Column(Integer, nullable=False) # Connects to your generated molecule's ID
    rating = Column(Integer, nullable=False)      # 1 to 5 stars or 1/-1 upvotes
    comment = Column(String, nullable=True)       # Optional written notes
    created_at = Column(DateTime, default=datetime.utcnow)
