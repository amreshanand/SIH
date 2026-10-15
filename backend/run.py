from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.core.config import settings
from backend.app import create_app

app = create_app()

if __name__ == "__main__":
    import uvicorn

    backend_dir = str(Path(__file__).resolve().parent)
    uvicorn.run(
        "backend.run:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.debug,
        reload_dirs=[backend_dir],
    )

