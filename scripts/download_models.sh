#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "Downloading AI models..."

mkdir -p models

# YOLOv8n
if [ ! -f models/yolov8n.pt ]; then
    echo "Downloading YOLOv8n..."
    curl -L -o models/yolov8n.pt "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt"
    echo "  models/yolov8n.pt downloaded"
else
    echo "  models/yolov8n.pt already exists"
fi

echo ""
echo "Model download complete."
echo ""
echo "For road damage detection:"
echo "  1. Train on SDNET2018 or RDD2022 dataset"
echo "  2. Export as models/road_damage.pt"
echo "  3. Set MODEL_MODE=real in .env"
