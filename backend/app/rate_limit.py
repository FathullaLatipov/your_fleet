"""Minimal in-process rate limiter for abuse-prone endpoints.

Suitable for a single-process deployment; replace with a Redis-backed limiter
(e.g. slowapi + Redis) when running multiple workers. Documented in DEPLOY.md.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_hits: dict[str, deque[float]] = defaultdict(deque)
_MAX_KEYS = 10_000


def rate_limit(request: Request, bucket: str, *, limit: int, window_s: int) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{ip}"
    now = time.monotonic()
    q = _hits[key]
    while q and q[0] < now - window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests; try again later"
        )
    q.append(now)
    if len(_hits) > _MAX_KEYS:  # crude memory guard
        _hits.clear()
