# UrbanSense AI — FINAL IMPLEMENTATION PLAN

Target: 9.5–10/10. Execution order matters. Every phase ends with
TEST → FIX → VERIFY → DOCUMENT. We never move forward with known P0 failures.

## Honest constraint context

The environment reality (verified in Phase 0):
- **PostGIS is NOT installed** (brew install postgis was aborted by the user twice).
  We will implement a **fully adaptive spatial layer**: auto-detect PostGIS;
  if available use `GEOGRAPHY(Point,4326)` + GiST + `ST_DWithin`/`ST_Distance`;
  if not, use the existing haversine fallback. The system will be **honest** in
  `/api/system/health` (`postgis: installed | fallback`).
- **No Docker daemon** → Docker build/up cannot be executed here; Docker files
  will be made correct and documented as "not executed in this environment".
- **No real YOLO/PaddleOCR/ByteTrack** → keep mocks, but build a **capability
  registry** that reports the truthful mode per capability and enforces
  `ALLOW_MOCK_FALLBACK` so we never silently claim real AI.

---

## PHASE 0 — Audit  ✅ (DONE)
Outputs: `CURRENT_STATE.md` (this) + inventory in conversation. All P0 bugs found.

---

## PHASE 1 — Correctness + health (P0)
Priority: highest. Fix the crashes and truthfulness defects.

1. Backend `Settings`: add edge-side fields (or a separate lightweight source of
   truth) so `health.py`/`streaming.py` resolve. Simplest: add
   `model_mode`, `gps_mode`, `ai_mode`, `video_source`, `bus_id`, `camera_position`
   with safe defaults to backend `Settings` (read from .env, documented).
2. `health.py` / `streaming.py`: fix references; make health return
   `database/postgis (installed|fallback)/ai_mode/gps_mode/demo_mode/verification
   thresholds`; never crash.
3. `edge/evidence/capture.py`: `main.py` passes real `ai_mode`/`model_name`;
   capture overlay uses actual mode.
4. `edge/main.py`:
   - OCR crops the **detected vehicle bbox**, not the hardcoded rect.
   - Fix `_inference_latency_ms` (do not overwrite total with detection-only).
   - Remove dead `streamer` (or wire it behind a real server — we remove it to avoid
     wasted encoding; keep MJPEG as documented future feature).
   - Guard `source.open()`, `gps.initialize()`, `detector.detect()`,
     `tracker.update()`, `road_defect.detect()` so a single component failure never
     crashes the pipeline.
5. Fix `phone_gps.py` recovery: transient failures mark DEGRADED, re-connect on
   next poll; never permanently kill GPS.
6. Fix YOLO infinite retry loop: backoff on load failure.
7. Fix ByteTrack mapping: map track→detection by IoU similarity, not position.
8. `edge/upload_queue.py`: corrupt-file backup + no silent data loss; add
   PENDING/UPLOADING/UPLOADED/FAILED/DEAD_LETTER state machine.
9. Unify event ID format.
10. `simulated.py`: real speed/heading from route direction; time-proportional
    interpolation.

## PHASE 2 — Real PostGIS + spatial layer (P1)
1. Add `backend/app/services/spatial.py`: `spatial_engine()` probe → `postgis` or
   `haversine`; `distance_m()`; `within_m()`; `cluster_nearby()`.
2. New Alembic migration: `CREATE EXTENSION IF NOT EXISTS postgis` (guarded, no-op
   when unavailable) + add optional `geog` `GEOGRAPHY(Point,4326)` columns + GiST
   indexes on `events`, `issues`, `incidents`, `gps_points`, `traffic_records`,
   `verification_records` **when PostGIS present** (checked at runtime via
   `PostGIS_Version()`).
3. `issue_service.create_or_merge_issue`: use spatial engine (PostGIS
   `ST_DWithin` when available, else haversine). Add bbox pre-filter for perf.
4. Ensure waiting for issue clustering correctness + dedup + async transaction
   safety (unique partial index on issue_events to prevent double-merge races).
5. Expose `spatial_engine` in health + a `GET /api/system/spatial` detail.

## PHASE 3 — AI capability registry + honest status (P1)
1. `backend/app/services/capabilities.py`: single source of truth
   `{vehicle_detection, road_defect_detection, tracking, ocr, pedestrian_detection,
   incident_detection, gps}` each `{mode: REAL|MOCK|SIMULATED, detail}`.
2. Config `ALLOW_MOCK_FALLBACK` (default true for prototype); when REAL requested
   but unavailable → report `UNAVAILABLE` unless fallback allowed.
3. `GET /api/system/health` + `GET /api/system/status` return capability map.
4. Frontend system-health card shows truthful badges (● LIVE EDGE AI / ● SIMULATED
   / MOCK AI / GPS SIMULATED). Never show "AI ONLINE" when everything is mock.

## PHASE 4 — Edge reliability + sensing session (P1)
1. Add `SensingSession` model (backend) + edge `sensing_session` report:
   session_id, bus_id, camera_id, started_at, ended_at, gps_source, ai_mode,
   frame_count, event_count, upload_count, error_count. Endpoint to close session.
2. Edge component-state reporting (CAMERA/GPS/AI/BACKEND/QUEUE → ONLINE/DEGRADED/
   OFFLINE/RECONNECTING) surfaced via a status endpoint / WS, and into health.
3. Event upload queue: state machine (PENDING/UPLOADING/UPLOADED/FAILED/DEAD_LETTER),
   retry with jitter, 4xx no-retry, dead-letter + backup corruption.
4. Camera/GPS/backend reconnection logic with backoff (1s/2s/5s/10s/30s + jitter).

## PHASE 5 — Issue + verification correctness (P1)
1. Verification: replace “load 20 and count in python” with
   `COUNT(DISTINCT bus_id)` + `COUNT(DISTINCT bus_id) FILTER (WHERE
   detection_result='CLEAR')`; enforce min time separation between distinct buses
   in addition to dedup window; unique index to prevent duplicate verification.
2. Issue state machine: enforce in `issue_service` (not just route); add audit +
   WS + notification for every transition (open→assigned→in_progress→
   pending_verification→resolved→reopened).
3. Notification on issue creation to routed department authorities.
4. Issue clustering: enforce at most one active issue per cluster for a type;
   serialize cluster merge with a lock/tx.

## PHASE 6 — Security (P1)
1. Startup validation: required `DATABASE_URL`, `SECRET_KEY`, `EDGE_API_KEY`;
   reject default secrets when `PRODUCTION=true`.
2. Enforce `EDGE_API_KEY` on `/api/events` and GPS/telemetry ingestion (a real
   EDGE role using `EDGE_API_KEY` header) while keeping user-JWT path for humans.
3. Apply auth deps to **all** mutation + list endpoints (require_auth / require
   _admin / require_authority) — fixes S5 completely.
4. Rate limiting on /login, /register, /events, /verification (in-memory
   sliding window, e.g. 5/min/IP for login).
5. Fix CORS: restrict origins (config `CORS_ORIGINS`), don't mix `*` with
   credentials.
6. Add security headers middleware, request size limits, input validation/
   max-length on schemas.
7. `access_token_expire_minutes` honored.

## PHASE 7 — GIS + analytics intelligence (P1)
1. `analytics.py`: real insights engine computing detections/day, issue trends,
   severity distribution, resolution rate, avg resolution time, verification
   success, reopen rate, road health. Provide 7d/30d ranges.
2. Traffic: all from `traffic_records` (no random). Add `insights` endpoint that
   computes sentences from data (e.g. "defects up 18% this week").
3. Spatial insights (issue density, hotspots, problematic routes) via spatial
   engine when PostGIS present, else approximations clearly labeled.
4. Fix `notifications.py` unread totals per user.

## PHASE 8 — Frontend command center (P1)
Read `node_modules/next/dist/docs/` per AGENTS.md before editing.
1. System health/status page with truthful capability badges.
2. Strengthen `api.ts`: auth token header, 401/403/404/409/422/429/500 handling,
   typed errors, abort/timeout.
3. Improve WS client: heartbeat + exponential backoff reconnect (1/2/5/10/30s +
   jitter), surface LIVE/RECONNECTING/OFFLINE.
4. Per-page loading/error/empty/success states; remove remaining `.catch(()=>{})`
   and `any`.
5. Map command-center: layer toggles, filters (severity/status/department/type),
   marker popups with source badge.
6. Live page wired to real edge/backend status; show inference ms, FPS, GPS, mode.
7. Issue detail: lifecycle stepper, severity explanation, observed-by buses,
   verification table, timeline, audit, map, evidence, source badge.

## PHASE 9 — Demo experience (P1)
1. Keep the 21-step deterministic lifecycle. Add real DB writes + WS + audit for
   each step (no fake delays that break sequence). Add SEED/RESET/START/NEXT/FAST-
   FORWARD controls.
2. `SIH MODE` (one-click): clean → seed → run → show health/map/feed/authority/
   verification/resolution.
3. Every surfaced data point carries a source badge (LIVE/SIMULATED/MOCK).

## PHASE 10 — Testing (P1) → 100+ meaningful tests
1. Backend: auth/z, issue lifecycle, spatial clustering (with & without PostGIS),
   verification dedup/resolve/reopen, routing, audit, notifications, traffic,
   analytics insights, health truthfulness, security (secret validation, rate
   limit, unauthorized-mutation rejection), edge-api-key enforcement.
2. Edge: camera, GPS (incl. reconnect), detector, tracker (incl. ByteTrack IoU
   mapping), event engine, queue state machine/retry/corruption, evidence labeling,
   shutdown, failure recovery.
3. Golden integration test: full lifecycle from clean DB (session→camera→gps→
   detect→track→confirm→evidence→queue→upload→event→issue→merge→route→assign→
   in_progress→pending_verification→BUS-002/3/4 CLEAR→resolved→new detection→
   reopened).
4. Frontend: Playwright happy-path (login, dashboard, issue, demo, map) — best-effort
   if playwright installable; otherwise document.

## PHASE 11 — Docker / deployment (P2)
Correctness: healthchecks wired to fixed `/api/system/health`; env validation;
startup migrations; PostGIS image `initdb` with `CREATE EXTENSION`. Note in docs
that Docker was not executed in this environment.

## PHASE 12 — Documentation (P2)
README, ARCHITECTURE, API, DEMO, DEPLOYMENT, SECURITY, AI_MODELS. Architecture
diagrams, privacy-by-design (data retention, evidence-only storage, plate masking
note), scalability, judge Q&A doc.

## PHASE 13 — Final audit + gate (P0)
`FINAL_AUDIT.md` with honest per-category scores, before/after, and explicit
"still mocked / not run" statements. Definition-of-done checklist executed.

---

## Prioritization summary

| Priority | Items |
|----------|-------|
| **P0** | health (B1), streaming (B2), evidence labeling (B4), OCR bbox (B3), latency (B7), ByteTrack map (B5), GPS recovery (B6), YOLO retry, queue corruption, startup validation, auth on all mutation endpoints |
| **P1** | PostGIS adaptive layer, capability registry + truthful status, sensing session, state-machine enforcement, verification COUNT(DISTINCT)+dedup, notifications, GIS analytics insights, frontend command center + WS reconnect, demo, 100+ tests, golden integration |
| **P2** | Docker correctness (unverifiable here), full docs, Playwright, privacy docs |
| **P3** | MJPEG streaming server, plate masking feature |

We begin execution at **PHASE 1**.
