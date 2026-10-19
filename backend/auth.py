"""회원가입/로그인: 회원 정보는 users.csv, 로그인 표(token)는 서버 메모리에 보관

표 목록은 메모리에만 있으므로 서버를 다시 켜면 모두 로그아웃됩니다.
"""
import csv
import hashlib
import hmac
import re
import secrets
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

USERS_PATH = Path(__file__).parent / "users.csv"
FIELDS = ["nickname", "user_id", "password_hash"]
USER_ID_RE = re.compile(r"^[a-z0-9_]{4,20}$")
HASH_ITERATIONS = 600_000

_users_lock = threading.Lock()  # 동시에 가입해도 중복 저장되지 않게
_tokens: dict[str, dict] = {}  # 표 -> {"user_id", "nickname"}
_tokens_lock = threading.Lock()

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)  # 표가 없을 때 403 대신 직접 401을 내려고 끔


# ---------- 비밀번호 해시 ----------
def hash_password(password: str) -> str:
    """솔트를 붙여 PBKDF2로 해시. 결과: 방식$반복수$솔트$해시"""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ITERATIONS)
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        method, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if method != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------- users.csv ----------
def read_users() -> list[dict]:
    if not USERS_PATH.exists():
        return []
    with USERS_PATH.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def append_user(user: dict) -> None:
    is_new = not USERS_PATH.exists()
    with USERS_PATH.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if is_new:
            writer.writeheader()
        writer.writerow(user)


# ---------- 표(token) ----------
def issue_token(user_id: str, nickname: str) -> str:
    token = secrets.token_urlsafe(32)
    with _tokens_lock:
        _tokens[token] = {"user_id": user_id, "nickname": nickname}
    return token


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    """Authorization: Bearer <표> 로 로그인한 사람을 찾음 (후기 쓰기 등에서도 사용 예정)"""
    user = _tokens.get(cred.credentials) if cred else None
    if not user:
        raise HTTPException(401, "로그인이 필요합니다")
    return {**user, "token": cred.credentials}


# ---------- 요청 모양 ----------
def _lower_id(v: str) -> str:
    return v.strip().lower() if isinstance(v, str) else v


class SignupIn(BaseModel):
    nickname: str
    user_id: str
    password: str = Field(min_length=8, max_length=64)

    @field_validator("nickname")
    @classmethod
    def check_nickname(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 20:
            raise ValueError("닉네임은 앞뒤 공백을 빼고 1~20자여야 합니다")
        return v

    @field_validator("user_id")
    @classmethod
    def check_user_id(cls, v: str) -> str:
        v = _lower_id(v)
        if not USER_ID_RE.match(v):
            raise ValueError("아이디는 영문 소문자, 숫자, _ 로 4~20자여야 합니다")
        return v


class LoginIn(BaseModel):
    user_id: str = Field(min_length=1)
    password: str = Field(min_length=1)

    _normalize_id = field_validator("user_id")(_lower_id)


# ---------- 주소 ----------
@router.post("/signup", status_code=201)
def signup(body: SignupIn):
    with _users_lock:
        users = read_users()
        if any(u["user_id"] == body.user_id for u in users):
            raise HTTPException(409, "이미 쓰고 있는 아이디입니다")
        if any(u["nickname"] == body.nickname for u in users):
            raise HTTPException(409, "이미 쓰고 있는 닉네임입니다")
        append_user({"nickname": body.nickname, "user_id": body.user_id, "password_hash": hash_password(body.password)})
    token = issue_token(body.user_id, body.nickname)
    return {"token": token, "nickname": body.nickname, "user_id": body.user_id}


@router.post("/login")
def login(body: LoginIn):
    user = next((u for u in read_users() if u["user_id"] == body.user_id), None)
    # 아이디가 없을 때와 비밀번호가 틀렸을 때 같은 문장 (어느 쪽인지 알려 주지 않음)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
    token = issue_token(user["user_id"], user["nickname"])
    return {"token": token, "nickname": user["nickname"], "user_id": user["user_id"]}


@router.post("/logout")
def logout(user: dict = Depends(current_user)):
    with _tokens_lock:
        _tokens.pop(user["token"], None)
    return {"detail": "로그아웃되었습니다"}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return {"nickname": user["nickname"], "user_id": user["user_id"]}
