# UrbanSense AI — CURRENT STATE (Phase 0 Audit)

Date: 2026-08-27
Auditor: Principal Architect / SIH technical mentor (automated + expert review)

This document is the result of a complete read-and-verify audit of the repository.
It is a snapshot of what exists, what works, and what is broken or misleading.
The companion document `FINAL_IMPLEMENTATION_PLAN.md` defines the remediation.

---

## 1. Architecture (as built)

```
PHONE CAMERA + GPS (simulated)
        |
        v
EDGE AI COMPUTER  (edge/main.py — EdgePipeline)
        |  OpenCV + Mock/YOLO detector
        |  Mock/ByteTrack tracker
        |  road defect detector
        |  event engine (temporal confirmation)
        |  evidence capture
        |  JSON upload queue (disk-backed)
        v
FASTAPI BACKEND  (backend/app — create_app)
        |  JWT auth (passlib/bcrypt, PyJWT)
        |  event ingestion
        |  issue clustering (haversine) + routing
        |  verification engine (dedup + auto-resolve/reopen)
        |  notifications
        |  analytics / traffic / dashboard
        |  WebSocket manager (4 channels)
        v
POSTGRESQL (PostGIS NOT enabled)  <-  models use Float lat/lon
        v
NEXT.JS COMMAND CENTER  (frontend/, 12 page.tsx)
```

Components: backend (48 routes), edge (~1,574 LOC), frontend (12 pages),
2 Alembic migrations, 68 tests (26 groups) previously passing.

---

## 2. Data Flow

1. `PhoneStreamSource`/`FileVideoSource` reads a frame.
2. `SimulatedGPSProvider` supplies lat/lon from a JSON route file.
3. `detector.detect(frame)` → `Detection[]` (mock: deterministic; real: YOLO).
4. `tracker.update(detections, frame)` → assigns persistent track IDs.
5. `road_defect_detector.detect(frame)` → defect detections.
6. `event_engine.process_detection()` performs temporal confirmation; on
   threshold → `Event`.
7. `evidence_capture.capture()` writes a stamped JPEG; `upload_queue.enqueue()`.
8. `_upload_loop()` POSTs `PUT /api/events` (actually POST) with retry/backoff.
9. Backend `create_event` inserts `Event`, broadcasts WS, calls
   `create_or_merge_issue`.
10. `create_or_merge_issue` spatial-clusters via **haversine** (no PostGIS),
    routes to a department, creates/merges `Issue`, broadcasts.
11. Authority assigns / works via `PATCH /api/issues/{id}` + `/assign`.
12. `process_verification` dedups by bus, counts independent CLEAR/DETECTED,
    auto-resolves (3 CLEAR) or reopens (2 DETECTED).
13. Demo `POST /api/demo/run` walks a 21-step lifecycle.

---

## 3. Critical Bugs (P0 — must fix)

| # | Location | Bug |
|---|----------|-----|
| B1 | `backend/app/api/health.py` | References `settings.model_mode`, `settings.gps_mode` which **do not exist** on the backend `Settings` class → `GET /api/system/health` raises `AttributeError` (500). Confirmed via runtime check. |
| B2 | `backend/app/api/streaming.py` | References `settings.bus_id`, `settings.camera_position`, `settings.video_source` which **do not exist** on the backend `Settings` → `/api/stream/*` returns 500. |
| B3 | `edge/main.py` `_create_incident_event` | OCR crops a **hardcoded** bbox `(100,100,300,250)` unrelated to any detected vehicle; OCR result is meaningless. |
| B4 | `edge/evidence/capture.py` | `ai_mode`/`model_name` default to `"SIMULATED"`/`"mock"` and `main.py` **never passes** them → every evidence image is mislabeled "SIMULATED DEMO" even in real mode. |
| B5 | `edge/tracking/vehicle_tracker.py` ByteTrack | Assumes positional 1:1 mapping between ByteTrack `tracks` and input detections; ByteTrack does not guarantee order → wrong track IDs assigned. |
| B6 | `edge/gps/phone_gps.py` | Any transient error sets `_available=False` permanently; GPS never recovers on reconnection. Also uses blocking `httpx.get` inside async loop. |
| B7 | `edge/main.py` line 149 | `_inference_latency_ms` is overwritten by the *detection-only* timing, discarding the correct total frame latency computed at line 128. |
| B8 | `edge/streaming/server.py` | Entire MJPEG streaming subsystem is dead code — `stream_mjpeg()` is never mounted on any server; all encoding/client work is wasted. |

---

## 4. Security Risks

| # | Risk |
|---|------|
| S1 | `SECRET_KEY` default `"change-me-to-a-random-secret-key"` accepted in `.env`, even in production — no startup validation, no enforcement. |
| S2 | `EDGE_API_KEY` default not enforced; **no endpoint consumes the edge API key** (events endpoint only checks `require_auth` with a user JWT). Edge/client separation is not implemented. |
| S3 | `CORSMiddleware` allows `origins=["*"]` with `allow_credentials=True` (invalid combination; credentials + wildcard is disallowed by browsers — silently broken auth flows cross-origin). |
| S4 | **No rate limiting** on `/auth/login`, `/auth/register`, `/events`, `/verification`. |
| S5 | `issues.py`, `buses.py`, `notifications.py`, `traffic.py`, `analytics.py`, `authorities.py`, `verification.py` mutation/list endpoints have **no auth dependency** (`require_auth`/`require_admin`/`require_authority`). Only `events` POST and `demo` are gated. An unauthored caller can reassign/change issues, create buses, etc. |
| S6 | `secret_key` used directly to sign JWTs with `HS256`; no alg-confusion hardening, no `iss`/`aud`. |
| S7 | JWT uses fixed 24h expiry, ignores `access_token_expire_minutes` setting. |
| S8 | No request-size limits, no evidence-upload validation, no filename sanitization (future evidence uploads). |
| S9 | `incident_service.py` and `edge` duplicate `Detection`/`GPSData` dataclasses instead of sharing a schema. |

---

## 5. Performance Risks

| # | Risk |
|---|------|
| P1 | **N+1/aggregate**: verification_service fetches all recent verifications (limit 20) to count unique buses instead of a `COUNT(DISTINCT bus_id)` query. |
| P2 | Issue clustering loads **all** issues of a type in `.in_(...)` statuses and computes haversine in Python for each — O(n) per event, no spatial index, no bbox pre-filter. Will not scale. |
| P3 | `notifications.py` counts ALL notifications and unread globally regardless of `user_id` filter (wrong totals). |
| P4 | `analytics.py` `road-health` and `route-performance` do multiple round-trip aggregate queries. |
| P5 | WebSocket `broadcast` iterates and `send_json` sequentially per client (no concurrency). |
| P6 | Edge upload loop sleeps a fixed 1s and sends one event at a time (no true batching/HTTP pipelining). |
| P7 | `database/session.py` engine `echo=settings.debug` plus `pool_size/max_overflow` hardcoded. |
| P8 | No metrics / no performance telemetry beyond a single latency number. |

---

## 6. AI Limitations (honest inventory)

| Capability | Current | Truth |
|-----------|---------|-------|
| Vehicle detection | YOLO if `MODEL_MODE=real` else Mock | **Running in mock** (`MODEL_MODE=mock`) |
| Road defect | Real if model file exists else Mock | **Mock** |
| Tracking | ByteTrack if importable else Mock IoU | **Mock** |
| OCR | PaddleOCR if enabled else Mock | **Mock** (`OCR_ENABLED=false`) |
| GPS | Phone if `GPS_MODE=phone` else Simulated | **SIMULATED** |
| Pedestrian risk | pixel-distance `<100` heuristic in `main.py` | resolution-dependent, uncalibrated |
| Incident engine | `incident_service.py` basic proximity → PEDESTRIAN_RISK | minimal, no scoring/explainability |
| Speed estimation | dead `estimated_speed` property (never used) | not integrated |

The UI currently shows generic "AI ONLINE" claims that conflate mock with real.

---

## 7. GIS Limitations

| # | Limitation |
|---|-----------|
| G1 | **PostGIS extension never activated**; all spatial work is Python haversine on `Float` columns. |
| G2 | No `GEOGRAPHY(Point,4326)` columns, no GiST indexes, no `ST_DWithin`/`ST_Distance`/`ST_Intersects`. |
| G3 | No spatial aggregation helpers (issue density, hotspots, road health from geometry). |
| G4 | `heatmap` uses `avg(latitude)/avg(longitude)` (mean center), not geometry. |
| G5 | Models use separate `latitude`/`longitude` Float columns (good for fallback) but no POINT column. |

---

## 8. Frontend Issues

| # | Issue |
|---|-------|
| F1 | `health`/`stream` API calls would fail (backend 500) — not wired into any page yet (verified). |
| F2 | Some pages may still show hardcoded stats / not all use real API data (need per-page verification). |
| F3 | No loading/error/empty/success states everywhere (`.catch(()=>{})` replaced earlier but not fully audited). |
| F4 | Not strongly typed end-to-end in some handlers (need `any` audit). |
| F5 | No WebSocket heartbeat/reconnect backoff; frontend doesn't surface `LIVE/RECONNECTING/OFFLINE`. |
| F6 | No auth token handling in `api.ts` (no Authorization header piping, no 401 handling). |
| F7 | Map is Leaflet with markers only; no layer toggles/heatmap/GiST-driven data. |
| F8 | Next.js 16 + Turbopack (recent upgrade); `AGENTS.md` mandates reading `node_modules/next/dist/docs/` before coding. |

---

## 9. Testing Gaps

| # | Gap |
|---|-----|
| T1 | No tests for the **P0 bugs** (health, streaming, evidence labeling, ByteTrack mapping, GPS recovery). |
| T2 | No tests for edge failure recovery (backend-down, GPS reconnect, camera failure). |
| T3 | No `COUNT(DISTINCT)` verification test / no concurrency/race test for simultaneous issue reporting. |
| T4 | No frontend E2E (Playwright). |
| T5 | No golden end-to-end integration test that runs the full lifecycle from a clean DB. |
| T6 | No security tests (secret validation, rate limit, unauthorized mutation rejection). |
| T7 | Current 68 tests do not cover many new P1 features to be added. |

---

## 10. Deployment Gaps

| # | Gap |
|---|-----|
| D1 | Dockerfiles/Compose exist but **still not verified** to build/run (`docker compose build/up` not executed — no daemon). `.dockerignore` fixed so both `Dockerfile.backend` and `Dockerfile.frontend` COPY targets (`backend/`, `edge/`, `data/`, `frontend/`) are present. |
| D2 | PostGIS extension wired explicitly: `data/postgis_init/01-postgis.sql` mounted to `/docker-entrypoint-initdb.d` in Compose; the `postgis/postgis:16-3.4` image also auto-enables it on `POSTGRES_DB`. |
| D3 | Startup env validation present: `validate_config()` in `backend/app/core/config.py` rejects weak `SECRET_KEY`/missing `EDGE_API_KEY` when `PRODUCTION=true` and requires `DATABASE_URL`. |
| D4 | Dockerfile.backend healthcheck now wired to `/api/system/health` (was `/docs`). |
| D5 | Migrations auto-run on deploy via `backend/docker-entrypoint.sh` (`alembic upgrade head` before uvicorn). |
| D6 | `.env` not git-tracked; `.env.example` documents all vars including a Docker section. |

---

## 11. Observability Gaps

| # | Gap |
|---|-----|
| O1 | Backend logs are ad-hoc `print`/`logging` with no request-ID correlation. |
| O2 | No structured component-status (CAMERA/GPS/AI/BACKEND/QUEUE) surfaced to UI. |
| O3 | Edge logs are colored but no per-session ID, no metrics counters exposed. |
| O4 | No `/api/system/health` working (B1) — the observability entry point is broken. |

---

## 12. Summary Verdict

The system has a **correct and impressive core concept** (distributed bus sensing →
temporal confirmation → spatial clustering → authority action → independent
multi-bus verification → auto-resolve/reopen) and a working demo. However:

- **One P0 crash** (system health) and several **truthfulness defects** (evidence
  mislabeled, "AI ONLINE" claims, mock/real conflation).
- **No real PostGIS**, **no rate limiting**, **auth missing on most mutation
  endpoints**, **no edge API key enforcement**, **default secrets accepted**.
- Edge has **dead streaming code**, **permanent GPS failure on transient errors**,
  **infinite YOLO retry**, and **hardcoded/unrealistic sub-values**.
- Testing does not cover the above; no E2E; no Docker verification.

Baseline score: **6.6/10**. See `FINAL_IMPLEMENTATION_PLAN.md` for the roadmap
to target 9.5–10/10.
