from datetime import datetime, timedelta, timezone
from typing import Any, Union, Optional
import bcrypt
import jwt
from app.core.config import settings


def get_password_hash(password: str) -> str:
    """Hash password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


def create_access_token(
    subject: Union[str, Any],
    role: str = "employee",
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict] = None,
) -> str:
    """Generate JWT access token."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "exp": expire,
        "iat": now,
        "sub": str(subject),
        "role": role,
    }
    if extra_claims:
        to_encode.update(extra_claims)

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token_status(token: str) -> tuple[Optional[dict], str]:
    """Decode a local HS256 JWT and distinguish expired vs invalid tokens."""
    if not token or not isinstance(token, str):
        return None, "invalid"
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        return payload, "valid"
    except jwt.ExpiredSignatureError:
        return None, "expired"
    except jwt.PyJWTError:
        return None, "invalid"


def decode_access_token(token: str) -> Optional[dict]:
    """Decode and validate JWT access token."""
    payload, _ = decode_access_token_status(token)
    return payload


def is_firebase_id_token_format(token: str) -> bool:
    """
    Firebase ID tokens are asymmetric (RS256) JWTs carrying a 'kid' header.
    Local HS256 session tokens do not have a 'kid' claim and must not be sent
    to Firebase Admin verify_id_token().
    """
    if not token or not isinstance(token, str) or token.count(".") != 2:
        return False
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return False
    return bool(header.get("kid")) and header.get("alg") != settings.ALGORITHM
