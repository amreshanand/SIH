from __future__ import annotations

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.websocket.manager import ws_manager

router = APIRouter()


async def _handle_incoming(websocket: WebSocket, text_data: str) -> None:
    try:
        msg = json.loads(text_data)
        if isinstance(msg, dict) and msg.get("type") == "ping":
            await websocket.send_json({"type": "pong", "t": msg.get("t")})
    except Exception:
        pass


@router.websocket("/ws/events")
async def events_ws(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket, "events")
    try:
        while True:
            data = await websocket.receive_text()
            await _handle_incoming(websocket, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "events")


@router.websocket("/ws/camera/{camera_id}")
async def camera_ws(websocket: WebSocket, camera_id: str) -> None:
    await ws_manager.connect(websocket, f"camera:{camera_id}")
    try:
        while True:
            data = await websocket.receive_text()
            await _handle_incoming(websocket, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, f"camera:{camera_id}")


@router.websocket("/ws/buses")
async def buses_ws(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket, "buses")
    try:
        while True:
            data = await websocket.receive_text()
            await _handle_incoming(websocket, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "buses")


@router.websocket("/ws/notifications")
async def notifications_ws(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket, "notifications")
    try:
        while True:
            data = await websocket.receive_text()
            await _handle_incoming(websocket, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "notifications")

