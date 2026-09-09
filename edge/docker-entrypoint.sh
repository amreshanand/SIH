#!/bin/sh
# Container entrypoint for the UrbanSense edge pipeline (real inference).
# Fails fast if required model weights are missing — production must never
# silently start a pipeline with no detection capability.
set -e

MODEL_VEHICLE="${YOLO_MODEL_PATH:-models/yolov8n.pt}"
MODEL_DAMAGE="${ROAD_DAMAGE_MODEL_PATH:-models/road_damage.pt}"

if [ ! -f "/app/$MODEL_VEHICLE" ]; then
    echo "[edge] ERROR: vehicle model weights not found at /app/$MODEL_VEHICLE" >&2
    echo "[edge] Download via: scripts/download_models.sh" >&2
    exit 1
fi

if [ ! -f "/app/$MODEL_DAMAGE" ]; then
    echo "[edge] ERROR: road-damage model weights not found at /app/$MODEL_DAMAGE" >&2
    echo "[edge] Train on RDD2022/SDNET2018 and export as models/road_damage.pt" >&2
    exit 1
fi

echo "[edge] Model weights verified (vehicle + road damage). Starting REAL inference pipeline..."
exec python -m edge.main
