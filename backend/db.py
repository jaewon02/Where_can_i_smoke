import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).parent / "zones.db"
USERS_DB_PATH = Path(__file__).parent / "users.db"  # 회원 정보는 zones.db와 따로 보관


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


# ---------- 회원 정보 (users.db) ----------
def get_users_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(USERS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_users_db() -> None:
    with get_users_conn() as conn:
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


def migrate_users_from_zones_db() -> None:
    """예전에 zones.db에 있던 users 표를 users.db로 옮김 (옛 표가 없으면 아무것도 안 함)

    users.db에 이미 있는 아이디는 건너뜀. 닉네임이 겹쳐 옮기지 못한 회원이 있으면
    정보를 잃지 않도록 zones.db의 users 표를 지우지 않고 남겨 둠.
    """
    with closing(get_conn()) as zconn:
        if not zconn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone():
            return
        old_users = zconn.execute(
            "SELECT nickname, user_id, password_hash, created_at FROM users ORDER BY id"
        ).fetchall()

    moved, skipped, failed = 0, 0, []
    with closing(get_users_conn()) as uconn, uconn:  # 모두 넣은 뒤 한 번에 커밋
        for u in old_users:
            if uconn.execute("SELECT 1 FROM users WHERE user_id = ?", (u["user_id"],)).fetchone():
                skipped += 1
                continue
            try:
                uconn.execute(
                    "INSERT INTO users (nickname, user_id, password_hash, created_at) VALUES (?,?,?,?)",
                    (u["nickname"], u["user_id"], u["password_hash"], u["created_at"]),
                )
                moved += 1
            except sqlite3.IntegrityError:  # 다른 아이디가 같은 닉네임을 이미 쓰는 경우
                failed.append(u["user_id"])

    if failed:
        print(f"[users 옮기기] 닉네임이 겹쳐 옮기지 못한 아이디: {failed} — zones.db의 users 표를 남겨 둡니다")
        return
    with closing(get_conn()) as zconn, zconn:
        zconn.execute("DROP TABLE users")
    print(f"[users 옮기기] zones.db → users.db: {moved}명 옮김, {skipped}명 건너뜀, zones.db의 users 표 삭제")
