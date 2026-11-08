import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    """Sliding-window limit per client IP. In-process only, which is fine for one instance."""

    def __init__(self, limit: int, window_s: float):
        self.limit = limit
        self.window_s = window_s
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        hits = self.hits[key]
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(429, "Too many requests, slow down a little")
        hits.append(now)
        if len(self.hits) > 10_000:
            for k in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window_s]:
                del self.hits[k]
