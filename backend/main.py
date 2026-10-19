import sqlite3
import uuid
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from auth import LoginIn, SignupIn, current_user, hash_password, issue_token, revoke_token, verify_password
from db import get_conn, get_users_conn, init_db, init_users_db, migrate_users_from_zones_db

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_PHOTOS = 4
MAX_PHOTO_BYTES = 5 * 1024 * 1024

app = FastAPI(title="흡연구역 지도 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def startup() -> None:
    init_db()
    init_users_db()
    migrate_users_from_zones_db()


def sniff_image_ext(data: bytes) -> str | None:
    """확장자/Content-Type은 믿지 않고 파일 앞부분(매직 바이트)으로 이미지 종류를 판별"""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


@app.get("/api/zones")
def list_zones(
    south: float = Query(..., description="지도 남쪽 위도"),
    west: float = Query(..., description="지도 서쪽 경도"),
    north: float = Query(..., description="지도 북쪽 위도"),
    east: float = Query(..., description="지도 동쪽 경도"),
    type: Literal["smoking", "nonsmoking"] | None = None,
    limit: int = Query(500, le=2000),
):
    sql = "SELECT * FROM zones WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?"
    params: list = [south, north, west, east]
    if type:
        sql += " AND type = ?"
        params.append(type)
    sql += " LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params)]


@app.get("/api/zones/{zone_id}")
def get_zone(zone_id: int):
    """구역 상세 + 후기(사진 포함)"""
    with get_conn() as conn:
        zone = conn.execute("SELECT * FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not zone:
            raise HTTPException(404, "구역을 찾을 수 없습니다")
        reviews = [
            dict(r)
            for r in conn.execute(
                "SELECT id, author, rating, content, created_at FROM reviews WHERE zone_id = ? ORDER BY id DESC",
                (zone_id,),
            )
        ]
        for rv in reviews:
            # 샘플 후기는 외부 더미 이미지 주소(http...)를 그대로, 업로드 사진은 서버 경로로 변환
            rv["photos"] = [
                p["filename"] if p["filename"].startswith("http") else f"/api/uploads/{p['filename']}"
                for p in conn.execute("SELECT filename FROM review_photos WHERE review_id = ? ORDER BY id", (rv["id"],))
            ]
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1) if reviews else None
    return {"zone": dict(zone), "review_count": len(reviews), "avg_rating": avg, "reviews": reviews}


@app.post("/api/zones/{zone_id}/reviews", status_code=201)
async def create_review(
    zone_id: int,
    author: str = Form(..., min_length=1, max_length=20),
    rating: int = Form(..., ge=1, le=5),
    content: str = Form(..., min_length=1, max_length=500),
    photos: list[UploadFile] = File(default=[]),
):
    author, content = author.strip(), content.strip()
    if not author or not content:
        raise HTTPException(422, "닉네임과 후기 내용을 입력해 주세요")
    photos = [p for p in photos if p.filename]  # 비어 있는 파일 입력 제외
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(422, f"사진은 최대 {MAX_PHOTOS}장까지 올릴 수 있습니다")

    # 파일을 먼저 모두 검증한 뒤에 저장 (일부만 저장되는 상황 방지)
    validated: list[tuple[bytes, str]] = []
    for p in photos:
        data = await p.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "사진 한 장은 5MB 이하여야 합니다")
        ext = sniff_image_ext(data)
        if not ext:
            raise HTTPException(415, "JPG, PNG, WEBP 이미지만 올릴 수 있습니다")
        validated.append((data, ext))

    with get_conn() as conn:
        zone = conn.execute("SELECT type FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not zone:
            raise HTTPException(404, "구역을 찾을 수 없습니다")
        if zone["type"] != "smoking":
            raise HTTPException(403, "후기는 흡연구역에만 남길 수 있습니다")
        cur = conn.execute(
            "INSERT INTO reviews (zone_id, author, rating, content) VALUES (?,?,?,?)",
            (zone_id, author, rating, content),
        )
        review_id = cur.lastrowid
        for data, ext in validated:
            name = f"{uuid.uuid4().hex}{ext}"  # 원본 파일명은 쓰지 않음
            (UPLOAD_DIR / name).write_bytes(data)
            conn.execute("INSERT INTO review_photos (review_id, filename) VALUES (?,?)", (review_id, name))
    return {"id": review_id}


# ---------- 회원가입/로그인 (도우미 함수는 auth.py) ----------
@app.post("/api/auth/signup", status_code=201, tags=["auth"])
def signup(body: SignupIn):
    password_hash = hash_password(body.password)  # 시간이 걸리므로 DB를 열기 전에 계산
    with get_users_conn() as conn:
        if conn.execute("SELECT 1 FROM users WHERE user_id = ?", (body.user_id,)).fetchone():
            raise HTTPException(409, "이미 쓰고 있는 아이디입니다")
        if conn.execute("SELECT 1 FROM users WHERE nickname = ?", (body.nickname,)).fetchone():
            raise HTTPException(409, "이미 쓰고 있는 닉네임입니다")
        try:
            conn.execute(
                "INSERT INTO users (nickname, user_id, password_hash) VALUES (?,?,?)",
                (body.nickname, body.user_id, password_hash),
            )
        except sqlite3.IntegrityError:  # 위 확인과 저장 사이에 같은 아이디/닉네임이 먼저 들어온 경우
            raise HTTPException(409, "이미 쓰고 있는 아이디 또는 닉네임입니다")
    token = issue_token(body.user_id, body.nickname)
    return {"token": token, "nickname": body.nickname, "user_id": body.user_id}


@app.post("/api/auth/login", tags=["auth"])
def login(body: LoginIn):
    with get_users_conn() as conn:
        user = conn.execute(
            "SELECT nickname, user_id, password_hash FROM users WHERE user_id = ?", (body.user_id,)
        ).fetchone()
    # 아이디가 없을 때와 비밀번호가 틀렸을 때 같은 문장 (어느 쪽인지 알려 주지 않음)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
    token = issue_token(user["user_id"], user["nickname"])
    return {"token": token, "nickname": user["nickname"], "user_id": user["user_id"]}


@app.post("/api/auth/logout", tags=["auth"])
def logout(user: dict = Depends(current_user)):
    revoke_token(user["token"])
    return {"detail": "로그아웃되었습니다"}


@app.get("/api/auth/me", tags=["auth"])
def me(user: dict = Depends(current_user)):
    return {"nickname": user["nickname"], "user_id": user["user_id"]}
