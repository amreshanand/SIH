"""UrbanSense AI — Assemble Authentic RAD Dataset Video.

Directives satisfied:
8. REAL ROAD-VIDEO ASSETS: Assembles genuine sequential dashcam frames from the
   RAD dataset into primary video assets. Replaces YouTube / placeholder videos.
   Outputs to:
   - 'data/videos/rad_front.mp4' (edge/backend inference source)
   - 'frontend/public/videos/rad_pothole_dashcam.mp4' (frontend HTML5 video playback)
"""

import os
import re
import shutil
import subprocess
from pathlib import Path


def assemble_rad_video(
    output_edge_path: str = "data/videos/rad_front.mp4",
    output_frontend_path: str = "frontend/public/videos/rad_pothole_dashcam.mp4",
    fps: int = 12,
):
    data_dir = Path("data/rad_dataset")
    temp_dir = Path("scratch/rad_video_frames")
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Clean existing temp frames
    for f in temp_dir.glob("*.jpg"):
        f.unlink()

    # Find candidate videos from test and valid splits (unseen during training)
    # Order them sequentially for a continuous dashcam route experience
    preferred_sequences = [
        "138_10-07-2023_mp4",  # High pothole density
        "134_10-07-2023_mp4",  # Potholes and pavement cracks
        "24_13-06-2023_mp4",   # Urban street with traffic & defects
        "143_10-07-2023_mp4",  # Long road stretch
        "15_13-06-2023_mp4",   # Extended bus route with anomalies
    ]

    all_frames = []
    for vname in preferred_sequences:
        seq_frames = []
        for split in ["test", "valid", "train"]:
            img_dir = data_dir / split / "images"
            if not img_dir.exists():
                continue
            for img in img_dir.glob(f"{vname}*.jpg"):
                m = re.match(r"^(.+?_mp4)-(\d+)_", img.name)
                fnum = int(m.group(2)) if m else 0
                seq_frames.append((fnum, img))
        # Sort sequentially within each camera segment
        seq_frames.sort(key=lambda x: x[0])
        all_frames.extend([img for _, img in seq_frames])

    print(f"Total collected RAD dataset frames for video: {len(all_frames)}")
    if not all_frames:
        raise RuntimeError("No frames found for the specified RAD video sequences.")

    # Create sequential symlinks/copies in temp_dir for ffmpeg
    for idx, frame_path in enumerate(all_frames):
        dst = temp_dir / f"frame_{idx:05d}.jpg"
        shutil.copyfile(frame_path, dst)

    # Ensure output directories exist
    Path(output_edge_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_frontend_path).parent.mkdir(parents=True, exist_ok=True)

    # Run ffmpeg to encode browser-compliant H.264 MP4
    temp_mp4 = temp_dir / "compiled.mp4"
    cmd = [
        "/opt/homebrew/bin/ffmpeg",
        "-y",
        "-framerate", str(fps),
        "-i", str(temp_dir / "frame_%05d.jpg"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "22",
        str(temp_mp4),
    ]
    print("Running ffmpeg command:", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {res.stderr}")

    # Copy to both edge and frontend destinations
    shutil.copyfile(temp_mp4, output_edge_path)
    shutil.copyfile(temp_mp4, output_frontend_path)

    edge_size = os.path.getsize(output_edge_path) / (1024 * 1024)
    fe_size = os.path.getsize(output_frontend_path) / (1024 * 1024)

    print(f"Successfully assembled authentic RAD video:")
    print(f" - Edge destination: {output_edge_path} ({edge_size:.2f} MB)")
    print(f" - Frontend destination: {output_frontend_path} ({fe_size:.2f} MB)")
    print(f" - Total frames: {len(all_frames)}, Framerate: {fps} FPS, Duration: {len(all_frames)/fps:.1f}s")


if __name__ == "__main__":
    assemble_rad_video()
