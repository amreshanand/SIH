# AI Model Weights

Place your model files in this directory:

- `yolov8n.pt` — YOLOv8 nano (vehicle/general detection)
- `road_damage.pt` — Custom road damage model

## Download YOLOv8

```bash
# ultralytics will auto-download yolov8n.pt on first run
# or download manually:
wget https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt -O models/yolov8n.pt
```

## Road Damage Model

Options:
1. Train on SDNET2018 or RDD2022 dataset
2. Use a pre-trained model from the community
3. Place as `models/road_damage.pt`

See `scripts/download_models.sh` for automated setup.
