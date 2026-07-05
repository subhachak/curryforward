from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from ..models import AdminAuditLog


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else None


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
