"""Small, standalone router: which LLM models are currently usable, based on
which provider API keys are set. Admin-gated — the model dropdown it powers
only appears in the (admin-only) research workspace."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_admin
from ..llm_client import available_models

router = APIRouter(prefix="/api/models")


@router.get("")
def list_models(role: str = Depends(require_admin)):
    return available_models()
