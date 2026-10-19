import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load environment variables from a .env file
load_dotenv()

# Get your database URL from environment variables.
# Format: postgresql://username:password@localhost:5432/database_name
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/your_database")

# 1. Create the engine that communicates with PostgreSQL
engine = create_engine(DATABASE_URL)

# 2. Create a session factory for executing queries
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 3. Base class for creating database tables (Models)
Base = declarative_base()

# 4. Dependency function to safely open and close DB connections
def get_db():
    """
    Yields a database session. Automatically closes the connection
    after the backend operation is completed.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

import json

def init_feedback_database(cursor, connection):
    """Run this once to build the feedback ledger in Postgres."""
    create_table_query = """
    CREATE TABLE IF NOT EXISTS molecule_feedback (
        id SERIAL PRIMARY KEY,
        molecule_id INT NOT NULL REFERENCES generated_molecules(id) ON DELETE CASCADE,
        rating_type VARCHAR(20) NOT NULL, -- 'thumbs_up', 'thumbs_down', or 'star'
        rating_value INT NOT NULL,         -- 1 for up, 0 for down, or 1-5 for stars
        comment TEXT,                      -- Free text for chemist notes
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    cursor.execute(create_table_query)
    connection.commit()
    print("PostgreSQL: molecule_feedback table initialized.")

def save_molecule_feedback(cursor, connection, molecule_id: int, rating_type: str, rating_value: int, comment: str = None):
    """Inserts a new user feedback row into PostgreSQL."""
    insert_query = """
        INSERT INTO molecule_feedback (molecule_id, rating_type, rating_value, comment)
        VALUES (%s, %s, %s, %s)
        RETURNING id;
    """
    try:
        cursor.execute(insert_query, (molecule_id, rating_type, rating_value, comment))
        feedback_id = cursor.fetchone()[0] # Gets the newly generated row ID
        connection.commit()
        return {"status": "success", "feedback_id": feedback_id}
    except Exception as e:
        connection.rollback() # Roll back database transaction if it fails
        print(f"Postgres Save Error: {e}")
        return {"status": "error", "message": str(e)}
