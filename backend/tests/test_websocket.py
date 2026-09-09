"""WebSocket broadcast manager — fan-out to subscribers across channels."""

from __future__ import annotations

import asyncio

import pytest

from backend.app.websocket.manager import ws_manager


class FakeWebSocket:
    """Minimal stand-in implementing accept / send_json / receive_text."""

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = False

    async def accept(self) -> None:
        pass

    async def send_json(self, payload: dict, **kwargs) -> None:
        self.sent.append(payload)

    async def receive_text(self) -> str:
        await asyncio.sleep(0)
        return ""  # ends the handler loop

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_broadcast_reaches_subscribed_channel():
    a = FakeWebSocket()
    b = FakeWebSocket()
    await ws_manager.connect(a, "events")
    await ws_manager.connect(b, "camera:FRONT")

    await ws_manager.broadcast("events", {"type": "new_event", "event_id": "E1"})
    await ws_manager.broadcast("camera:FRONT", {"type": "frame", "n": 1})

    assert any(m.get("event_id") == "E1" for m in a.sent)
    assert any(m.get("n") == 1 for m in b.sent)
    # Channel isolation: bus B subscribed to camera channel only.
    assert all(m.get("type") != "new_event" for m in b.sent)

    ws_manager.disconnect(a, "events")
    ws_manager.disconnect(b, "camera:FRONT")


@pytest.mark.asyncio
async def test_disconnected_client_no_longer_receives():
    a = FakeWebSocket()
    await ws_manager.connect(a, "events")
    ws_manager.disconnect(a, "events")
    await ws_manager.broadcast("events", {"type": "new_event", "event_id": "E2"})
    assert a.sent == []
    ws_manager.disconnect(a, "events")


@pytest.mark.asyncio
async def test_websocket_heartbeat_ping_pong():
    from backend.app.websocket.handlers import _handle_incoming
    ws = FakeWebSocket()
    await _handle_incoming(ws, '{"type": "ping", "t": 1720000000}')
    assert len(ws.sent) == 1
    assert ws.sent[0] == {"type": "pong", "t": 1720000000}