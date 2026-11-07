import os
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://furprint:furprint@localhost:5433/furprint"
)


class Pool:
    """Opened per app lifespan, so tests and reloads can start the app more than once."""

    _pool: ConnectionPool | None = None

    def open(self) -> None:
        self._pool = ConnectionPool(
            DATABASE_URL, min_size=1, max_size=10, open=True, kwargs={"row_factory": dict_row}
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
    schema = (Path(__file__).parent / "schema.sql").read_text()
    with pool.connection() as conn:
        conn.execute(schema)
