# UrbanSense AI — Architecture Document

> Smart India Hackathon project: AI-powered urban infrastructure monitoring using
> municipal bus-mounted cameras for real-time road defect detection, traffic analysis,
> and incident reporting.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EDGE LAYER (Per Bus)                          │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │  Camera   │→│    AI    │→│ Event Engine │→│  Upload Queue (HTTP) │  │
│  │  Source   │  │ Detector │  │  + Temporal  │  │  + Evidence Capture │  │
│  └──────────┘  │ + Tracker │  │  Validation  │  └────────┬───────────┘  │
│                └──────────┘  └─────────────┘            │              │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐            │              │
│  │   GPS    │  │   OCR    │  │  MJPEG      │            │              │
│  │ Provider │  │ Provider │  │  Streamer   │            │              │
│  └──────────┘  └──────────┘  └─────────────┘            │              │
└──────────────────────────────────────────────────────────┼──────────────┘
                                                           │ HTTP POST
                                                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BACKEND LAYER (FastAPI)                          │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────────────────┐  │
│  │  REST API  │  │  WebSocket Mgr │  │  Service Layer                │  │
│  │  38+ Endpoints│ │  4 Channels   │  │  - IssueService              │  │
│  └─────┬──────┘  └───────┬────────┘  │  - VerificationService       │  │
│        │                 │            │  - AuditService               │  │
│        ▼                 ▼            │  - NotificationService        │  │
│  ┌─────────────────────────────┐     └──────────────────────────────┘  │
│  │    SQLAlchemy (Async)       │                                       │
│  │    16 Tables, UUID PKs     │                                       │
│  └─────────────┬───────────────┘                                       │
└────────────────┼───────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     DATA LAYER (PostgreSQL + PostGIS)                   │
│  ┌─────────────────────┐  ┌────────────────────────────────────────┐   │
│  │   PostgreSQL 16     │  │   PostGIS 3.4 (image available but    │   │
│  │   + asyncpg driver  │  │   not activated at runtime — uses      │   │
│  └─────────────────────┘  │   haversine fallback)                  │   │
│                           └────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND LAYER (Next.js)                          │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────────────────┐  │
│  │  Dashboard  │  │  Map View      │  │  WebSocket Consumer          │  │
│  │  (Stats)    │  │  (Leaflet)     │  │  (Real-time Updates)         │  │
│  └────────────┘  └────────────────┘  └──────────────────────────────┘  │
│  Port 3000                                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Three-tier design rationale:**
- **Edge**: Runs on each bus. Performs local inference to minimize bandwidth. Only
  confirmed events (after temporal validation) are uploaded to the backend.
- **Backend**: Centralized API server. Receives events, creates/merges issues,
  manages the full lifecycle, and broadcasts real-time updates via WebSocket.
- **Frontend**: Read-only dashboard for administrators, authorities, and viewers.
  Consumes REST APIs and WebSocket streams.

---

## 2. Data Flow — The Complete Lifecycle

The core innovation is the closed-loop lifecycle where the same bus fleet that
detects problems also verifies their resolution.

```
DETECT → REPORT → ASSIGN → ACT → VERIFY → RESOLVE → REOPEN
```

### Numbered Sequence

| Step | Phase | Action | Component |
|------|-------|--------|-----------|
| 1 | **DETECT** | Edge AI detects pothole with YOLO, tracks it across frames | Edge Pipeline |
| 2 | **DETECT** | Temporal engine confirms detection after N observations within window | EventEngine |
| 3 | **DETECT** | Evidence image captured and attached to event | EvidenceCapture |
| 4 | **REPORT** | Event uploaded to backend via HTTP POST | UploadQueue |
| 5 | **REPORT** | Backend creates or merges into existing Issue (haversine clustering) | IssueService |
| 6 | **REPORT** | Issue auto-routed to correct department (e.g. ROAD_MAINTENANCE) | DEPARTMENT_ROUTING map |
| 7 | **REPORT** | WebSocket broadcast: `new_issue` to all connected clients | ConnectionManager |
| 8 | **ASSIGN** | Authority user accepts the issue assignment | PATCH /issues/{id}/assign |
| 9 | **ASSIGN** | Issue status transitions: OPEN → ASSIGNED | State machine |
| 10 | **ACT** | Authority updates status to IN_PROGRESS (work begins) | PATCH /issues/{id} |
| 11 | **ACT** | Work completes, status → PENDING_VERIFICATION | PATCH /issues/{id} |
| 12 | **VERIFY** | Different bus passes same location, detects CLEAR | VerificationService |
| 13 | **VERIFY** | Dedup check: skip if same bus verified within 30s window | OBSERVATION_DEDUP_WINDOW |
| 14 | **VERIFY** | Count unique-bus CLEAR observations | verification_clear_threshold (3) |
| 15 | **RESOLVE** | 3+ independent CLEAR observations from different buses → auto-RESOLVED | VerificationService |
| 16 | **REOPEN** | Bus later detects problem again → 2+ DETECTED observations → REOPENED | verification_reopen_threshold (2) |

### Valid Status Transitions

```
OPEN ──────────────→ ASSIGNED ──────────→ IN_PROGRESS
 ↑                      ↑                      │
 │                      │                      ▼
 │                      │              PENDING_VERIFICATION
 │                      │                      │
 │                      │           ┌──────────┘
 │                      │           ▼
 └── REOPENED ←──── RESOLVED
         ↑
         └──── (detected again by passing bus)
```

---

## 3. Database Architecture

### 16 Tables (not 26 — the user-visible model count includes enums and mixins)

All tables use **UUID primary keys** (v4) via the `BaseModel` abstract class:

```python
class BaseModel(Base):
    __abstract__ = True
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
```

### Table Catalog

| # | Table | Key Columns | Purpose |
|---|-------|-------------|---------|
| 1 | **buses** | bus_number (unique), route_id, status | Municipal bus fleet |
| 2 | **cameras** | bus_id (FK), position, status, stream_url | Camera hardware per bus |
| 3 | **routes** | route_name (unique), stops (JSONB) | Bus route definitions |
| 4 | **gps_points** | bus_id (FK), lat, lon, speed, heading | GPS telemetry |
| 5 | **events** | event_id (unique), event_type, severity, lat/lon | Raw AI detection events |
| 6 | **issues** | issue_id (unique), issue_type, severity, status | Consolidated urban issues |
| 7 | **issue_events** | issue_id (FK), event_id (FK) | Many-to-many: issue ↔ events |
| 8 | **issue_assignments** | issue_id (FK), authority_id (FK), notes | Authority assignments |
| 9 | **incidents** | incident_id (unique), incident_type, plate_text | Safety incidents |
| 10 | **vehicle_tracks** | track_id, bus_id (FK), trajectory (JSONB) | ByteTrack output storage |
| 11 | **traffic_records** | bus_id (FK), vehicle_count, congestion_score | Traffic data snapshots |
| 12 | **evidence** | event_id (FK), incident_id (FK), file_path | Image/file evidence links |
| 13 | **verification_records** | issue_id (FK), bus_id (FK), detection_result | Multi-bus verification |
| 14 | **users** | username (unique), password_hash, role | Auth + role management |
| 15 | **notifications** | user_id (FK), title, body, read | In-app notifications |
| 16 | **audit_logs** | user_id (FK), action, entity_type, old/new values | Change audit trail |

### Key Relationships

```
Route 1──N Bus 1──N Camera
Bus 1──N GPSPoint
Bus 1──N Event ──N Issue (via IssueEvent)
Bus 1──N VehicleTrack
Bus 1──N TrafficRecord
Bus 1──N VerificationRecord
Issue 1──N IssueAssignment → User
Issue 1──N VerificationRecord
Issue 1──N IssueEvent → Event
Event 1──N Evidence
Incident 1──N Evidence
User 1──N Notification
User 1──N AuditLog
```

### Why No PostGIS Yet

The PostGIS image (`postgis/postgis:16-3.4`) is used in Docker Compose, but the
extension is **never activated** (`CREATE EXTENSION IF NOT EXISTS postgis`). All
spatial queries use **haversine distance** in Python:

```python
def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    # ... standard haversine formula
```

This works for the prototype because:
- Issue clustering checks one issue type at a time (small result set)
- No bounding-box or radius queries that benefit from spatial indexes
- No geometry columns or spatial joins needed yet

For production, PostGIS would enable `ST_DWithin` queries, spatial indexes, and
proper geographic clustering.

---

## 4. AI Pipeline

The edge pipeline runs on each bus as a single async process (`edge/main.py`).

### Pipeline Stages

```
Camera Frame
    │
    ▼
┌──────────────────────────────────────────────┐
│ 1. DETECTION                                 │
│    - YOLO (real) or MockDetector (simulated) │
│    - Road defect detector (separate model)    │
│    - Classes: POTHOLE, ROAD_CRACK, etc.      │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ 2. TRACKING                                  │
│    - ByteTrack (real) or MockTracker         │
│    - Assigns persistent track IDs            │
│    - Counts unique vehicles                  │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ 3. TEMPORAL VALIDATION (EventEngine)         │
│    - Accumulates observations per class      │
│    - Requires N ≥ min_observations within     │
│      temporal_window (default 3s)            │
│    - Clears pending if window expires        │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ 4. SEVERITY SCORING                          │
│    - Base severity from class defaults       │
│    - Adjusted by confidence, area ratio,     │
│      observation count                       │
│    - Range: LOW → MEDIUM → HIGH → CRITICAL   │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ 5. EVIDENCE CAPTURE                          │
│    - Annotated frame saved as JPEG           │
│    - Metadata overlay: GPS, detection info   │
│    - Stored in data/evidence/ directory       │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│ 6. UPLOAD QUEUE                              │
│    - In-memory FIFO queue with retry         │
│    - Batch upload to backend POST /events    │
│    - Tracks failed event IDs for retry       │
└──────────────────────────────────────────────┘
```

### Additional Edge Capabilities

- **Pedestrian Risk Detection**: Cross-references person and vehicle bounding
  boxes in proximity (< 100px) to flag PEDESTRIAN_RISK events.
- **Traffic Congestion**: Triggers TRAFFIC_CONGESTION event when vehicle count
  exceeds `traffic_detection_threshold`.
- **OCR (Plate Reading)**: PaddleOCR or mock provider for license plate extraction.
- **MJPEG Streaming**: Annotated frames served via HTTP for dashboard live view.

---

## 5. API Architecture

### REST Endpoints (38 total, all under `/api` prefix)

| Module | Prefix | Endpoints | Methods |
|--------|--------|-----------|---------|
| **Auth** | `/auth` | `/login`, `/register` | POST, POST |
| **Events** | `/events` | `/{event_id}` | POST, GET, GET |
| **Issues** | `/issues` | `/{issue_id}`, `/{issue_id}/timeline`, `/{issue_id}/assign` | GET, GET, GET, PATCH, POST |
| **Incidents** | `/incidents` | `/{incident_id}` | POST, GET, GET |
| **Buses** | `/buses` | `/{bus_id}`, `/{bus_id}/cameras`, `/routes`, `/routes/all` | POST, GET, GET, GET, POST, GET |
| **Verification** | `/verification` | `/issue/{issue_id}` | POST, GET |
| **Dashboard** | `/dashboard` | `/stats` | GET |
| **Traffic** | `/traffic` | `/heatmap` | GET, GET |
| **Analytics** | `/analytics` | `/road-health`, `/route-performance`, `/od-matrix`, `/defect-trends` | GET×4 |
| **Notifications** | `/notifications` | `/{notification_id}/read` | GET, PATCH |
| **Authorities** | `/authorities` | — | GET |
| **Streaming** | `/stream` | `/camera`, `/status` | GET, GET |
| **Demo** | `/demo` | `/seed`, `/reset`, `/status`, `/run` | POST, POST, GET, POST |

Plus 1 health endpoint at `/api/system/health`.

### Authentication Model

- **JWT tokens** (HS256, 24h expiry) issued on login
- **bcrypt** password hashing (passlib)
- **Role-based access**: ADMIN, AUTHORITY, VIEWER
- **Edge API key** for device-to-backend communication
- Demo mode enables auto-auth for presentation flows

```python
# Role hierarchy
ADMIN    → full access (seed, reset, run demo, assign issues)
AUTHORITY → manage assigned issues, update status
VIEWER   → read-only dashboard access
```

---

## 6. WebSocket Architecture

### 4 Channels

| Channel | Path | Purpose | Messages |
|---------|------|---------|----------|
| **events** | `/ws/events` | All lifecycle events | `new_event`, `new_issue`, `issue_updated`, `issue_assigned`, `issue_resolved`, `issue_reopened`, `verification`, `incident_detected`, `demo_step` |
| **buses** | `/ws/buses` | Bus fleet telemetry | GPS updates, status changes |
| **camera** | `/ws/camera/{camera_id}` | Per-camera stream data | Annotated frames, detection overlays |
| **notifications** | `/ws/notifications` | User notifications | `notification` (title, body) |

### Broadcast Pattern

The `ConnectionManager` class maintains an in-memory dict of channel → [connections]:

```python
class ConnectionManager:
    active_connections: dict[str, list[WebSocket]]

    async def broadcast(channel, message):
        # Send to all connections on channel
        # Auto-prune dead connections

    async def send_personal(websocket, message):
        # Send to a single connection
```

Every state-changing API call broadcasts to the `events` channel. The frontend
subscribes to `/ws/events` and updates the UI reactively. No authentication is
required for WebSocket connections (intentional for the prototype).

---

## 7. Verification Architecture

The verification system is what makes UrbanSense unique — the **bus fleet itself**
acts as a distributed sensor network to verify issue resolution.

### Multi-Bus Independent Observation

```
Bus-002 passes pothole location → DETECTED (confidence 0.88)
Bus-003 passes same location   → DETECTED (confidence 0.91)
Bus-004 passes same location   → CLEAR    (confidence 0.94)
                                         ↓
                              RESOLVED (3 unique buses confirmed)
```

### Deduplication Window

```python
OBSERVATION_DEDUP_WINDOW_SECONDS = 30
```

If the **same bus** reports the same issue within 30 seconds, the observation is
deduplicated and ignored. This prevents spam from a single bus running slowly
through a defect zone.

### Auto-Resolve / Reopen Thresholds

| Threshold | Value | Trigger |
|-----------|-------|---------|
| `verification_clear_threshold` | **3** | Unique buses reporting CLEAR → RESOLVED |
| `verification_reopen_threshold` | **2** | Unique buses reporting DETECTED on resolved issue → REOPENED |

### Unique Bus Counting

The service counts observations per **unique bus_id** (not per observation):

```python
seen_buses: set[str] = set()
for v in recent_verifications:
    bid = str(v.bus_id)
    if bid in seen_buses:
        continue  # Skip duplicate bus
    seen_buses.add(bid)
    if v.detection_result == "CLEAR":
        unique_clear += 1
    elif v.detection_result == "DETECTED":
        unique_detected += 1
```

---

## 8. Demo Architecture

The demo system provides a **21-step deterministic lifecycle** that can be
triggered with a single API call.

### Pattern: Seed → Reset → Run

```bash
POST /api/demo/seed    # Populate database with 4 buses, cameras, sample data
POST /api/demo/reset   # TRUNCATE all tables (preserves admin user)
POST /api/demo/run     # Execute the 21-step lifecycle
GET  /api/demo/status  # Current state counts
```

### 21-Step Lifecycle

| Step | Action | What Happens |
|------|--------|--------------|
| 1-3 | STATUS | Bus begins route, systems come online |
| 4-6 | EVENT | Pothole detected 3 times (temporal confirmation) |
| 7-8 | STATUS | Evidence captured, event uploaded |
| 9-10 | STATUS | Issue RS-2026-DEMO1 created, routed to ROAD_MAINTENANCE |
| 11 | NOTIFICATION | Authority receives alert |
| 12 | ASSIGN | Authority accepts assignment |
| 13-14 | STATUS_UPDATE | Work starts → IN_PROGRESS → PENDING_VERIFICATION |
| 15-17 | VERIFY | BUS-002, BUS-003, BUS-004 pass location → all CLEAR |
| 18 | STATUS | System auto-resolves (3/3 independent CLEAR) |
| 19 | EVENT | BUS-001 detects pothole again (problem returned) |
| 20 | STATUS | System reopens issue |
| 21 | STATUS | Full loop demonstrated |

Each step broadcasts a WebSocket message to all connected clients with a 300ms
delay between steps for visual effect.

### Determinism

The demo uses fixed coordinates (18.5204, 73.8567 — University Road, Pune),
fixed bus IDs, and fixed detection results. Running the demo always produces the
same sequence of state transitions.

---

## 9. Security Architecture

### JWT Authentication

```
POST /api/auth/login  { username, password }
→ { access_token, user: { id, username, role, department } }

Header: Authorization: Bearer <token>
```

Token payload: `{ sub: user_id, role: "ADMIN", exp: 24h }`

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|-------------|
| **ADMIN** | Full access — seed/reset demo, assign issues, manage users |
| **AUTHORITY** | Manage assigned issues, update status, view their notifications |
| **VIEWER** | Read-only access to dashboard, events, issues |

Protected endpoints use FastAPI dependencies:

```python
@router.get("/protected")
async def endpoint(_user: dict = Depends(require_auth)):
    ...

@router.post("/admin-only")
async def endpoint(_admin: dict = Depends(require_admin)):
    ...
```

### Demo Mode Auto-Auth

When `DEMO_MODE=true`, the demo run endpoint bypasses authentication entirely.
The seed endpoint requires admin auth regardless. This allows the demo to run
without token management during presentations.

### Edge API Key

Edge devices authenticate to the backend using a shared API key
(`edge_api_key` in config), separate from the user JWT system.

---

## 10. Deployment Architecture

### Docker Compose (3 services)

```yaml
services:
  postgres:     # postgis/postgis:16-3.4
    ports:      5432
    volumes:    postgres_data (persistent)

  backend:      # FastAPI (Dockerfile.backend)
    ports:      8000
    depends_on: postgres (healthy)
    env:        DATABASE_URL (async), DATABASE_URL_SYNC (migrations)

  frontend:     # Next.js (Dockerfile.frontend)
    ports:      3000
    depends_on: backend
```

### Local Development Path

```bash
# 1. Start database
docker compose up -d postgres

# 2. Run backend directly
cd backend && python run.py          # uvicorn on :8000

# 3. Run frontend directly
cd frontend && npm run dev           # next dev on :3000

# 4. Run edge pipeline
python -m edge.main                  # requires camera/video source

# 5. Seed and run demo
curl -X POST localhost:8000/api/demo/seed
curl -X POST localhost:8000/api/demo/run
```

### Environment Configuration

Key `.env` variables:
- `DATABASE_URL` — PostgreSQL connection string (asyncpg)
- `SECRET_KEY` — JWT signing key
- `DEMO_MODE` — Enable/disable demo auto-auth
- `MODEL_MODE` — `real` (YOLO) or `mock` (simulated detections)
- `VIDEO_SOURCE` — `file`, `webcam`, `phone`, or `mock`
- `GPS_MODE` — `phone` or `simulated`

---

## 11. Known Limitations

| Limitation | Impact | Production Fix |
|------------|--------|----------------|
| **PostGIS not activated** | Spatial queries use Python haversine (slow at scale) | Run `CREATE EXTENSION postgis`, add geometry columns + GiST indexes |
| **Mock AI detector** | Default mode generates random bounding boxes | Ship with trained YOLOv8 weights, optimize with TensorRT |
| **No ByteTrack in production** | Vehicle re-identification unreliable | Enable ByteTrack tracker, tune parameters for bus-mounted cameras |
| **No real OCR** | License plates not extracted | Integrate PaddleOCR or EasyOCR with plate-specific fine-tuning |
| **Single camera per bus** | Limited field of view | Support multi-camera sync (FRONT/REAR/LEFT/RIGHT simultaneously) |
| **No authentication on WebSocket** | Any client can subscribe | Add token validation on WS handshake |
| **In-memory upload queue** | Events lost on edge crash | Add persistent queue (SQLite or Redis) |
| **No real-time GPS tracking** | GPS coordinates simulated | Integrate actual bus GPS via phone API or OBD-II |
| **No push notifications** | In-app only | Add FCM/APNs for mobile push, email via SMTP |
| **No rate limiting** | API vulnerable to abuse | Add slowapi or nginx rate limiting |
| **Demo-only coordinates** | Fixed Pune coordinates | Dynamic GPS from actual bus routes |

---

## 12. Component Status Matrix

| Component | Status | Evidence | Production Requirement |
|-----------|--------|----------|----------------------|
| **YOLO Detection** | MOCK | `MockDetector` class, random bbox generation | Train on Indian road defect dataset, export ONNX/TensorRT |
| **Road Defect Detector** | MOCK | `MockRoadDefectDetector`, random detections | Fine-tuned YOLOv8 on pothole/crack dataset |
| **ByteTrack** | SIMULATED | `MockTracker` class, no real tracking | Integrate ByteTrack with ReID model |
| **OCR** | MOCK | `MockOCRProvider`, no plate extraction | PaddleOCR with plate detection preprocessor |
| **GPS** | SIMULATED | `SimulatedGPSProvider`, hardcoded route | Phone GPS API or bus telematics integration |
| **Event Temporal Engine** | REAL | `EventEngine` with N-observation window | Validated, works with mock and real detections |
| **Issue Clustering** | REAL | Haversine-based, 50m radius merge | Replace with PostGIS ST_DWithin for scale |
| **Verification System** | REAL | Multi-bus independent observation, auto-resolve | Production-ready, needs real detection pipeline |
| **State Machine** | REAL | Valid transitions enforced, audit logged | Production-ready |
| **REST API** | REAL | 38+ endpoints, async SQLAlchemy | Add rate limiting, request validation |
| **WebSocket** | REAL | 4 channels, broadcast + personal | Add auth, consider Redis pub/sub for multi-instance |
| **JWT Auth** | REAL | HS256, bcrypt, RBAC | Add refresh tokens, token revocation |
| **PostgreSQL** | REAL | PostgreSQL 16, async sessions | Add connection pooling, read replicas |
| **PostGIS** | NOT INSTALLED | Image available, extension never created | `CREATE EXTENSION postgis` + migration |
| **Docker Compose** | REAL | 3-service stack, health checks | Add resource limits, monitoring |
| **Demo System** | REAL | 21-step deterministic lifecycle | Remove from production builds |
| **Audit Logging** | REAL | AuditLog model, old/new values | Add retention policy, archival |
| **Notifications** | PARTIAL | In-app only, no push/email | Add FCM, SMTP provider |
| **MJPEG Streaming** | REAL | Edge pipeline, HTTP server | Add auth, bandwidth management |
| **Frontend** | SEPARATE | Next.js in its own container | Needs integration testing |

### Summary Counts

| Metric | Count |
|--------|-------|
| Database tables | 16 |
| REST endpoints | 38 + 1 health |
| WebSocket channels | 4 |
| API modules | 13 |
| Edge pipeline stages | 6 |
| Demo lifecycle steps | 21 |
| User roles | 3 (ADMIN, AUTHORITY, VIEWER) |
| Issue statuses | 6 (OPEN → ASSIGNED → IN_PROGRESS → PENDING_VERIFICATION → RESOLVED → REOPENED) |
| Event types | 12 |
| Docker services | 3 |

---

*Document generated from codebase analysis. Last updated: August 2026.*
