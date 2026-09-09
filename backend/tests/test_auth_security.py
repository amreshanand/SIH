"""Auth, registration, RBAC and rate-limiting security tests."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import auth_header


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, admin_user):
    res = await client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "testpass123"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["user"]["role"] == "ADMIN"


@pytest.mark.asyncio
async def test_login_wrong_password_401(client: AsyncClient, admin_user):
    res = await client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "nope"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user_401(client: AsyncClient):
    res = await client.post(
        "/api/auth/login",
        json={"username": "ghost", "password": "whatever"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_register_always_forces_viewer(client: AsyncClient):
    res = await client.post(
        "/api/auth/register",
        json={"username": "newbie", "password": "password123"},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "VIEWER"


@pytest.mark.asyncio
async def test_register_duplicate_409(client: AsyncClient, viewer_user):
    res = await client.post(
        "/api/auth/register",
        json={"username": viewer_user.username, "password": "password123"},
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_admin_users_admin_only(client: AsyncClient, viewer_token, authority_token, admin_token):
    assert (await client.get("/api/admin/users", headers=auth_header(viewer_token))).status_code == 403
    assert (await client.get("/api/admin/users", headers=auth_header(authority_token))).status_code == 403
    assert (await client.get("/api/admin/users", headers=auth_header(admin_token))).status_code == 200


@pytest.mark.asyncio
async def test_no_token_401(client: AsyncClient):
    assert (await client.get("/api/admin/users")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_user_via_admin(client: AsyncClient, admin_token):
    res = await client.post(
        "/api/admin/users",
        headers=auth_header(admin_token),
        json={"username": "ops_staff", "password": "password123", "role": "AUTHORITY"},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "AUTHORITY"
    assert res.json()["username"] == "ops_staff"


@pytest.mark.asyncio
async def test_login_rate_limit_429(admin_user):
    # Fresh app instance = fresh per-IP middleware state (deterministic).
    from backend.app import create_app

    fresh_app = create_app()
    async with AsyncClient(transport=ASGITransport(app=fresh_app), base_url="http://test") as ac:
        codes = []
        for _ in range(6):
            res = await ac.post(
                "/api/auth/login",
                json={"username": admin_user.username, "password": "wrong-pass"},
            )
            codes.append(res.status_code)
    assert codes[:5] == [401] * 5
    assert codes[5] == 429