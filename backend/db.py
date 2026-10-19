import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "zones.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('smoking', 'nonsmoking')),
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                address TEXT,
                note TEXT,
                UNIQUE (name, lat, lng)
            )
            """
        )
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(zones)")]
        if "radius_m" not in cols:  # 기존 DB 마이그레이션: 금연구역 반경(미터)
            conn.execute("ALTER TABLE zones ADD COLUMN radius_m INTEGER")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_zones_geo ON zones (lat, lng)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
                author TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS review_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                filename TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_zone ON reviews (zone_id)")
