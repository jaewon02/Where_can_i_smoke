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
        # 주소 -> 좌표 변환 결과 캐시 (동기화를 다시 돌려도 카카오 API를 중복 호출하지 않음)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS geocode_cache (
                address TEXT PRIMARY KEY,
                lat REAL,
                lng REAL
            )
            """
        )
        # 금연 규칙에 해당하는 시설(학교, 어린이집, 병원 등)의 위치. 종류별 반경/규칙 문구는 프런트엔드(facilities.js)가 type_key로 결정
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS facilities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kakao_id TEXT NOT NULL UNIQUE,
                type_key TEXT NOT NULL,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_facilities_geo ON facilities (lat, lng)")
        # 시설 경계선 기준으로 계산한 금연 구역(다각형)과, 경계선을 모를 때 점 위치 기준으로 쓰는 반경(m)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(facilities)")]
        if "area" not in cols:
            conn.execute("ALTER TABLE facilities ADD COLUMN area TEXT")  # JSON: MultiPolygon 좌표 [[[ [lng,lat], ... ]]]
        if "r" not in cols:
            conn.execute("ALTER TABLE facilities ADD COLUMN r REAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL UNIQUE,
                user_id TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
            """
        )
