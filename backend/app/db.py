import logging
import os
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

log = logging.getLogger("furprint.db")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://furprint:furprint@localhost:5433/furprint"
)
MIGRATIONS = Path(__file__).parent / "migrations"


class Pool:
    """Opened per app lifespan, so tests and reloads can start the app more than once."""

    _pool: ConnectionPool | None = None

    def open(self) -> None:
        self._pool = ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=int(os.environ.get("DB_POOL_SIZE", "10")),
            open=True,
            kwargs={"row_factory": dict_row, "options": "-c statement_timeout=10000"},
        )

    def close(self) -> None:
        if self._pool:
            self._pool.close()
            self._pool = None

    def connection(self):
        if not self._pool:
            raise RuntimeError("Database pool is not open")
        return self._pool.connection()


pool = Pool()


def migrate() -> None:
    """Apply numbered SQL files once each. The advisory lock lets several
    instances start at the same time without racing."""
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(7461001)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done:
                continue
            log.info("applying migration %s", path.name)
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
