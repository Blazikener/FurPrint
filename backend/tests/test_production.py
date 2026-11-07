from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import pool
from app.main import app
from app.maintenance import run_cleanup

from .test_api import AL_REEM, ago, helper, jpeg_with_gps, new_case


def report_from(ip: str, slug: str, reason="scam"):
    # No `with`: entering a second client would run the lifespan again and close the shared pool.
    return TestClient(app, client=(ip, 1234)).post(f"/api/cases/{slug}/report", json={"reason": reason})


def test_reports_hide_case_after_three_distinct_people(client):
    created = new_case(client)
    slug = created["slug"]
    report_from("10.0.0.1", slug)
    report_from("10.0.0.1", slug)  # same person twice counts once
    report_from("10.0.0.2", slug)
    assert client.get(f"/api/cases/{slug}").status_code == 200
    report_from("10.0.0.3", slug)
    assert client.get(f"/api/cases/{slug}").status_code == 410
    assert client.get("/api/near", params=AL_REEM).json()["cases"] == []
    owner = client.get(f"/api/cases/{slug}", headers={"X-Owner-Key": created["owner_key"]}).json()
    assert owner["hidden"] is True


def test_admin_endpoints_need_token(client, monkeypatch):
    import app.main as main

    slug = new_case(client)["slug"]
    monkeypatch.setattr(main, "ADMIN_TOKEN", "")
    assert client.get("/api/admin/reports").status_code == 404
    monkeypatch.setattr(main, "ADMIN_TOKEN", "s3cret")
    assert client.get("/api/admin/reports").status_code == 401
    auth = {"Authorization": "Bearer s3cret"}
    report_from("10.0.0.9", slug, "spam")
    reports = client.get("/api/admin/reports", headers=auth).json()["cases"]
    assert reports[0]["slug"] == slug and reports[0]["reasons"] == ["spam"]
    client.post(f"/api/admin/cases/{slug}/hide", headers=auth)
    assert client.get(f"/api/cases/{slug}").status_code == 410
    client.post(f"/api/admin/cases/{slug}/restore", headers=auth)
    assert client.get(f"/api/cases/{slug}").status_code == 200
    assert client.get("/api/admin/reports", headers=auth).json()["cases"] == []


def test_owner_delete_removes_case_and_photos(client):
    photo = client.post("/api/photos", files={"file": ("c.jpg", jpeg_with_gps(), "image/jpeg")}).json()
    created = new_case(client, photo_id=photo["id"])
    slug = created["slug"]
    s_photo = client.post("/api/photos", files={"file": ("s.jpg", jpeg_with_gps(), "image/jpeg")}).json()
    client.post(f"/api/cases/{slug}/sightings", json={**helper(), **AL_REEM, "seen_at": ago(minutes=5),
                                                     "confidence": "sure", "photo_id": s_photo["id"]})
    assert client.delete(f"/api/cases/{slug}").status_code == 403
    assert client.delete(f"/api/cases/{slug}", headers={"X-Owner-Key": created["owner_key"]}).status_code == 200
    assert client.get(f"/api/cases/{slug}").status_code == 404
    assert client.get(photo["url"]).status_code == 404
    assert client.get(s_photo["url"]).status_code == 404


def test_cleanup_applies_retention(client):
    keep = new_case(client)["slug"]
    old = new_case(client)
    orphan = client.post("/api/photos", files={"file": ("c.jpg", jpeg_with_gps(), "image/jpeg")}).json()
    fresh_orphan = client.post("/api/photos", files={"file": ("c.jpg", jpeg_with_gps(), "image/jpeg")}).json()
    long_ago = datetime.now(timezone.utc) - timedelta(days=40)
    with pool.connection() as conn:
        conn.execute("UPDATE cases SET status = 'reunited', resolved_at = %s WHERE slug = %s", (long_ago, old["slug"]))
        conn.execute("UPDATE photos SET created_at = %s WHERE id = %s", (long_ago, orphan["id"]))
    counts = run_cleanup()
    assert counts["resolved cases"] == 1 and counts["orphan photos"] == 1
    assert client.get(f"/api/cases/{keep}").status_code == 200
    assert client.get(f"/api/cases/{old['slug']}").status_code == 404
    assert client.get(fresh_orphan["url"]).status_code == 200


def test_security_headers(client):
    res = client.get("/api/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in res.headers["Content-Security-Policy"]
    assert res.headers["Cache-Control"] == "no-store"
    assert res.headers["X-Request-Id"]
    assert client.get("/robots.txt").text.startswith("User-agent")


def test_link_preview_tags_are_escaped():
    from app.og import inject

    html = '<html><head><title>Furprint</title><meta name="description" content="x" /></head></html>'
    out = inject(html, {"title": 'Help find <script>"Luna"', "description": "d", "url": "https://f/c/x",
                        "image": "https://f/api/photos/1"})
    assert "<script>" not in out
    assert 'og:image" content="https://f/api/photos/1"' in out
    assert "<title>Help find &lt;script&gt;&quot;Luna&quot; · Furprint</title>" in out


def test_migrations_are_recorded_once(client):
    from app.db import migrate

    migrate()
    with pool.connection() as conn:
        names = [r["name"] for r in conn.execute("SELECT name FROM schema_migrations ORDER BY name").fetchall()]
    assert names == ["001_initial.sql", "002_moderation.sql"]


def test_delete_keeps_photos_other_cases_still_use(client):
    photo = client.post("/api/photos", files={"file": ("c.jpg", jpeg_with_gps(), "image/jpeg")}).json()
    first = new_case(client, photo_id=photo["id"])
    other = new_case(client, kind="found", photo_id=photo["id"])
    res = client.delete(f"/api/cases/{first['slug']}", headers={"X-Owner-Key": first["owner_key"]})
    assert res.status_code == 200
    assert client.get(f"/api/cases/{other['slug']}").json()["photo_url"] == photo["url"]
    assert client.get(photo["url"]).status_code == 200
