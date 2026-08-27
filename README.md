# UrbanSense AI

**Turning Every Bus into a Mobile Urban Sensor**

UrbanSense AI transforms public transport buses into mobile urban sensing units. Using onboard Edge AI to analyze multiple camera streams, the system detects road defects, analyzes traffic, identifies incidents, attaches GPS coordinates, and sends actionable intelligence to a centralized command platform.

## Architecture

```
Phone Camera → Edge AI Laptop → YOLO + ByteTrack + OCR → Event Engine
                                                           ↓
                                          GPS + Timestamp + Evidence Image
                                                           ↓
                                                    FastAPI Backend
                                                           ↓
                                                  PostgreSQL/PostGIS
                                                           ↓
                                            ┌──────────────┴──────────────┐
                                            ↓                             ↓
                                     GIS Command Center            Authority Portal
                                     (Map + Dashboard)             (Issue Workflow)
                                            ↓                             ↓
                                       Verification ← ← ← ← ← ← ← ← ← ←
                                            ↓
                                         RESOLVED
```

## Quick Start

```bash
# 1. Setup
chmod +x scripts/setup.sh
./scripts/setup.sh

# 2. Start backend
cd backend && python run.py

# 3. Start frontend
cd frontend && npm run dev

# 4. Start edge AI
python edge/main.py

# 5. Seed demo data
curl -X POST http://localhost:8000/api/demo/seed
```

## Access

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `VIDEO_SOURCE` | `phone`, `webcam`, or `file` | `phone` |
| `PHONE_STREAM_URL` | Phone camera MJPEG URL | `http://192.168.1.100:8080/video` |
| `GPS_MODE` | `phone` or `simulated` | `simulated` |
| `MODEL_MODE` | `real` or `mock` | `mock` |
| `DEMO_MODE` | Enable demo mode | `false` |

## Phone Dashcam Setup

1. Install an MJPEG camera app on your phone (e.g., IP Webcam for Android)
2. Start the camera server on your phone
3. Note the IP address and port
4. Set `PHONE_STREAM_URL=http://<phone-ip>:<port>/video` in `.env`
5. Set `VIDEO_SOURCE=phone` in `.env`

## Input Modes

| Mode | Source | Use Case |
|------|--------|----------|
| Phone | Live camera over WiFi | Primary demo |
| Webcam | Laptop built-in camera | Fallback |
| File | Pre-recorded video files | Demo/testing |

## Edge AI Pipeline

```
Frame → Resize → YOLO Detection → Tracking → Event Engine → GPS → Evidence → Backend
```

- **Detection**: YOLOv8n (nano) for vehicles, custom model for road defects
- **Tracking**: ByteTrack for multi-object tracking
- **OCR**: PaddleOCR for number plate recognition
- **GPS**: Phone GPS or simulated route following
- **Evidence**: Annotated images with metadata overlay

## Demo Commands

```bash
# Seed demo data
curl -X POST http://localhost:8000/api/demo/seed

# Create a live event
curl -X POST http://localhost:8000/api/events -H "Content-Type: application/json" -d '{
  "event_id": "EVT-001",
  "event_type": "POTHOLE",
  "bus_id": "<bus-uuid>",
  "severity": "HIGH",
  "confidence": 0.93,
  "latitude": 18.5204,
  "longitude": 73.8567,
  "source": "EDGE_AI"
}'

# Update issue status
curl -X PATCH http://localhost:8000/api/issues/<issue-id> -H "Content-Type: application/json" -d '{"status": "IN_PROGRESS"}'

# Assign issue to authority
curl -X POST http://localhost:8000/api/issues/<issue-id>/assign -H "Content-Type: application/json" -d '{"authority_id": "<user-uuid>"}'

# Verify issue resolution
curl -X POST http://localhost:8000/api/verification -H "Content-Type: application/json" -d '{
  "issue_id": "<issue-uuid>",
  "bus_id": "<bus-uuid>",
  "latitude": 18.5204,
  "longitude": 73.8567,
  "detection_result": "CLEAR",
  "confidence": 0.95
}'
```

## Issue Lifecycle

```
OPEN → ASSIGNED → IN_PROGRESS → PENDING_VERIFICATION → RESOLVED
  ↑                                                           ↓
  └──────────────────── REOPENED ← ← ← ← ← ← ← ← ← ← ← ← ←
```

## Spatial Clustering

Multiple buses detecting the same issue are automatically merged into a single issue using configurable distance thresholds (default: 50m). This prevents duplicate complaints.

## Features

- **Real-time GPS tracking** of fleet vehicles
- **AI-powered detection** of road defects, traffic congestion, pedestrian risk
- **Evidence capture** with annotated images and metadata
- **Authority routing** based on issue type (road maintenance, drainage, traffic police)
- **Automatic verification** — future bus observations verify if issues are resolved
- **Duplicate prevention** — spatial clustering prevents duplicate issues
- **WebSocket real-time updates** — dashboard receives live alerts
- **Privacy-first** — video processed at edge, only metadata sent to server

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Edge AI | Python, OpenCV, YOLOv8, ByteTrack, PaddleOCR |
| Backend | Python, FastAPI, SQLAlchemy, Pydantic |
| Database | PostgreSQL, PostGIS |
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Streaming | MJPEG WebSocket |
| Deployment | Docker Compose |

## Project Structure

```
urbansense-ai/
├── edge/          # Edge AI pipeline (runs on laptop)
├── backend/       # FastAPI backend + database
├── frontend/      # Next.js dashboard
├── models/        # AI model weights
├── data/          # Videos, GPS routes, evidence
├── scripts/       # Setup, seeding, model download
└── docker-compose.yml
```

## License

SIH 2026 Prototype — Educational use only.

---

**"A public transport bus becomes a mobile AI sensor that detects urban problems, understands their location and severity, informs the responsible authority, and continuously verifies whether the city actually fixed them."**
