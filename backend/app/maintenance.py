"""Retention jobs. Closed cases keep coordinates for 30 days, abandoned open
cases for 180 days, and photos nobody attached are dropped after a day."""

import logging
import threading

from .db import pool

log = logging.getLogger("furprint.cleanup")

CLEANUP_SQL = [
    ("resolved cases", "DELETE FROM cases WHERE resolved_at < now() - interval '30 days'"),
    ("stale open cases", "DELETE FROM cases WHERE status = 'open' AND seen_at < now() - interval '180 days'"),
    ("orphan photos", """DELETE FROM photos p WHERE p.created_at < now() - interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.photo_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sightings s WHERE s.photo_id = p.id)"""),
]


def run_cleanup() -> dict[str, int]:
    counts = {}
    with pool.connection() as conn:
        for label, sql in CLEANUP_SQL:
            counts[label] = conn.execute(sql).rowcount
    if any(counts.values()):
        log.info("cleanup %s", counts)
    return counts


class Cleaner:
    def __init__(self, interval_s: float):
        self.interval_s = interval_s
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.loop, daemon=True, name="cleanup")

    def loop(self) -> None:
        while not self.stop.wait(self.interval_s):
            try:
                run_cleanup()
            except Exception:
                log.exception("cleanup failed")

    def start(self) -> "Cleaner":
        if self.interval_s > 0:
            self.thread.start()
        return self

    def close(self) -> None:
        self.stop.set()
