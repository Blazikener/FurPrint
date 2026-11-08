import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("furprint")

TILES = "https://tiles.openfreemap.org"
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    f"img-src 'self' data: blob: {TILES}",
    f"connect-src 'self' {TILES}",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def headers_and_logging(request: Request, call_next):
        request_id = uuid.uuid4().hex[:12]
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error id=%s %s %s", request_id, request.method, request.url.path)
            response = JSONResponse({"detail": "Something went wrong on our side. Try again."}, status_code=500)
        path = request.url.path
        h = response.headers
        h["X-Request-Id"] = request_id
        h["X-Content-Type-Options"] = "nosniff"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["Permissions-Policy"] = "geolocation=(self), camera=(self), microphone=()"
        h["X-Frame-Options"] = "DENY"
        h["Content-Security-Policy"] = CSP
        if request.url.scheme == "https":
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")
            h["X-Robots-Tag"] = "noindex"
        elif path.startswith("/c/"):
            h["X-Robots-Tag"] = "noindex, nofollow"
        log.info("%s %s %s %.0fms id=%s", request.method, path, response.status_code,
                 (time.perf_counter() - start) * 1000, request_id)
        return response
