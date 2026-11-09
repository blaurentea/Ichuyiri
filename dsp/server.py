"""
FastAPI microservice for uploading new WhatsApp / field Sikuri recordings directly from the Web PWA.
"""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from analyzer import process_track, slugify

REPO_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = REPO_ROOT / "files" / "uploads"
TRACKS_DIR = REPO_ROOT / "web" / "public" / "tracks"

app = FastAPI(title="Ichuyiri MIR Engine API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "Ichuyiri MIR v3.0 (Sikuri de Varios Bombos)"}


@app.post("/api/analyze")
async def analyze_upload(
    file: UploadFile = File(...),
    title: str = Form(""),
) -> dict:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    TRACKS_DIR.mkdir(parents=True, exist_ok=True)

    safe_name = Path(file.filename or "upload.mpeg").name
    dest_path = UPLOAD_DIR / f"{int(time.time())}_{safe_name}"
    with dest_path.open("wb") as out_f:
        shutil.copyfileobj(file.file, out_f)

    tid = f"{slugify(title or Path(safe_name).stem)}-{int(time.time()) % 10000}"
    display_title = title.strip() or Path(safe_name).stem
    meta = process_track(dest_path, out_root=TRACKS_DIR, title=display_title, track_id=tid)

    # Append to catalog.json
    catalog_path = TRACKS_DIR / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else []
    catalog.insert(
        0,
        {
            "id": meta["id"],
            "title": meta["title"],
            "sourceFile": meta["sourceFile"],
            "duration": meta["duration"],
            "bpm": meta["bpm"],
            "bomboResonanceHz": meta["bomboResonanceHz"],
            "counts": meta["counts"],
            "benchmarkV1": meta["benchmarkV1"],
            "trackUrl": f"/tracks/{meta['id']}/track.json",
        },
    )
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta

