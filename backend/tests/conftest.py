import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://furprint:furprint@localhost:5433/furprint")

from fastapi.testclient import TestClient  # noqa: E402

from app.db import pool  # noqa: E402
from app.main import app, report_limit, upload_limit, write_limit  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        with pool.connection() as conn:
            conn.execute("TRUNCATE cases, photos, sightings, cell_claims, reports CASCADE")
        write_limit.hits.clear()
        upload_limit.hits.clear()
        report_limit.hits.clear()
        yield c
