"""Security utility functions for password hashing and verification.

Provides native bcrypt hashing and verification compatible with modern bcrypt
(>= 4.0 / 5.0) on Python 3.12 - 3.14 without passlib deprecation or 72-byte bugs.
"""
from __future__ import annotations

import bcrypt


class PasswordHasher:
    @staticmethod
    def verify(plain_password: str, hashed_password: str) -> bool:
        if not plain_password or not hashed_password:
            return False
        try:
            return bcrypt.checkpw(
                plain_password.encode("utf-8")[:72],
                hashed_password.encode("utf-8"),
            )
        except Exception:
            return False

    @staticmethod
    def hash(password: str) -> str:
        return bcrypt.hashpw(
            password.encode("utf-8")[:72],
            bcrypt.gensalt(),
        ).decode("utf-8")


# Drop-in replacement for passlib.hash.bcrypt
pwd_context = PasswordHasher()
bcrypt_compat = PasswordHasher()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return PasswordHasher.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return PasswordHasher.hash(password)
