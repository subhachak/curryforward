from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from ..models import AdminAuditLog
from .security import client_ip as _client_ip


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    return _client_ip(request)


def audit_admin_action(
    db: Session,
    *,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    request: Request | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AdminAuditLog(
            action=action,
            target_type=target_type,
            target_id=target_id,
            ip_address=client_ip(request),
            details=details or {},
        )
    )
