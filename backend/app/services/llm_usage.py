from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from ..models import LLMUsageLog

logger = logging.getLogger(__name__)


def _usage_value(usage: Any, key: str) -> int | None:
    if usage is None:
        return None
    if isinstance(usage, dict):
        value = usage.get(key)
    else:
        value = getattr(usage, key, None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def extract_token_usage(response: Any) -> dict[str, int | None]:
    usage = response.get("usage") if isinstance(response, dict) else getattr(response, "usage", None)
    prompt = _usage_value(usage, "prompt_tokens") or _usage_value(usage, "input_tokens")
    completion = _usage_value(usage, "completion_tokens") or _usage_value(usage, "output_tokens")
    total = _usage_value(usage, "total_tokens")
    if total is None and (prompt is not None or completion is not None):
        total = (prompt or 0) + (completion or 0)
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


def provider_from_model(model: str | None) -> str | None:
    if not model:
        return None
    return model.split("/", 1)[0] if "/" in model else "anthropic"


def record_llm_usage(
    *,
    task: str,
    model: str | None,
    role: str | None = None,
    status: str = "success",
    response: Any = None,
    error: str | None = None,
) -> None:
    from ..db import SessionLocal

    usage = extract_token_usage(response)
    db = SessionLocal()
    try:
        db.add(
            LLMUsageLog(
                task=task,
                model=model,
                provider=provider_from_model(model),
                role=role,
                status=status,
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
                total_tokens=usage["total_tokens"],
                error=(error[:1000] if error else None),
            )
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("llm_usage_log_failed", exc_info=True)
    finally:
        db.close()
