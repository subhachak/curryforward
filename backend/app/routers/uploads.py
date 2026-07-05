"""
Image uploads for research-flow recipe steps. Saved as plain files on disk
under backend/uploads/ — matches this app's local-first, no-hosted-dependency
design (no S3/cloud storage), served back via a static mount in main.py.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..auth import require_admin

router = APIRouter(prefix="/api/uploads")

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)  # must exist before main.py mounts it

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _sniff_image_extension(body: bytes) -> str | None:
    if body.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return ".webp"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    return None


@router.post("")
async def upload_image(file: UploadFile = File(...), role: str = Depends(require_admin)):
    ext = ALLOWED_CONTENT_TYPES.get(file.content_type)
    if ext is None:
        raise HTTPException(400, "Only JPEG, PNG, WEBP, or GIF images are allowed")

    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Image is too large (max 8MB)")
    actual_ext = _sniff_image_extension(body)
    if actual_ext is None:
        raise HTTPException(400, "Uploaded file is not a valid supported image")
    if actual_ext != ext:
        raise HTTPException(400, "Image content does not match its declared type")

    filename = f"{uuid.uuid4().hex}{ext}"
    (UPLOADS_DIR / filename).write_bytes(body)
    return {"url": f"/uploads/{filename}"}
