"""로그인 도우미: 비밀번호 해시, 로그인 표(token), 요청 모양 (라우트는 main.py)

회원 정보는 zones.db의 users 표에, 표 목록은 서버 메모리에 보관합니다.
표 목록은 메모리에만 있으므로 서버를 다시 켜면 모두 로그아웃됩니다.
"""
import hashlib
import hmac
import re
import secrets
import threading

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

USER_ID_RE = re.compile(r"^[a-z0-9_]{4,20}$")
HASH_ITERATIONS = 600_000

_tokens: dict[str, dict] = {}  # 표 -> {"user_id", "nickname"}
_tokens_lock = threading.Lock()

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


# ---------- 표(token) ----------
def issue_token(user_id: str, nickname: str) -> str:
    token = secrets.token_urlsafe(32)
    with _tokens_lock:
        _tokens[token] = {"user_id": user_id, "nickname": nickname}
    return token


def revoke_token(token: str) -> None:
    with _tokens_lock:
        _tokens.pop(token, None)


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
