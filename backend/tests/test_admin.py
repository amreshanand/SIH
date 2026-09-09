"""Admin panel — user CRUD, role changes, audit trail, RBAC guards."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import auth_header, create_user_in_db


@pytest.mark.asyncio
async def test_admin_user_listing(client: AsyncClient, admin_token, authority_user, viewer_user):
    res = await client.get("/api/admin/users", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    usernames = {u["username"] for u in body["users"]}
    assert usernames == {authority_user.username, viewer_user.username, "admin_ci"}
    assert body["total"] >= 3


@pytest.mark.asyncio
async def test_viewer_cannot_list_users(client: AsyncClient, viewer_token):
    res = await client.get("/api/admin/users", headers=auth_header(viewer_token))
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_create_user_and_role_change(client: AsyncClient, admin_token):
    res = await client.post(
        "/api/admin/users",
        headers=auth_header(admin_token),
        json={"username": "new_authority", "password": "password123", "role": "AUTHORITY"},
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    patch = await client.patch(
        f"/api/admin/users/{user_id}/role",
        headers=auth_header(admin_token),
        json={"role": "VIEWER"},
    )
    assert patch.status_code == 200
    assert patch.json()["role"] == "VIEWER"


@pytest.mark.asyncio
async def test_self_demotion_rejected(client: AsyncClient, admin_token, admin_user):
    res = await client.patch(
        f"/api/admin/users/{admin_user.id}/role",
        headers=auth_header(admin_token),
        json={"role": "VIEWER"},
    )
    assert res.status_code == 400
    assert "demote" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_role_change_writes_audit_log(client: AsyncClient, admin_token):
    other = await create_user_in_db("audit_target", "VIEWER")
    await client.patch(
        f"/api/admin/users/{other.id}/role",
        headers=auth_header(admin_token),
        json={"role": "AUTHORITY"},
    )

    logs = (await client.get("/api/admin/audit-logs", headers=auth_header(admin_token))).json()
    role_changes = [e for e in logs["logs"] if e["action"] == "USER_ROLE_CHANGE" and e["entity_id"] == str(other.id)]
    assert len(role_changes) == 1
    assert role_changes[0]["old_value"]["role"] == "VIEWER"
    assert role_changes[0]["new_value"]["role"] == "AUTHORITY"


@pytest.mark.asyncio
async def test_audit_log_pagination_and_filter(client: AsyncClient, admin_token):
    other = await create_user_in_db("audit_target2", "AUTHORITY")
    await client.patch(
        f"/api/admin/users/{other.id}/role",
        headers=auth_header(admin_token),
        json={"role": "VIEWER"},
    )

    filtered = (
        await client.get("/api/admin/audit-logs?action=USER_ROLE_CHANGE", headers=auth_header(admin_token))
    ).json()
    assert filtered["total"] >= 1
    assert all(e["action"] == "USER_ROLE_CHANGE" for e in filtered["logs"])


@pytest.mark.asyncio
async def test_udpate_role_requires_valid_role(client: AsyncClient, admin_token, viewer_user):
    res = await client.patch(
        f"/api/admin/users/{viewer_user.id}/role",
        headers=auth_header(admin_token),
        json={"role": "ROOT"},
    )
    assert res.status_code == 422