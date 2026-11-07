import io
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from PIL import Image

AL_REEM = {"lat": 24.4985, "lng": 54.4060}


def iso(dt: datetime) -> str:
    return dt.isoformat()


def ago(**kw) -> str:
    return iso(datetime.now(timezone.utc) - timedelta(**kw))


def new_case(client, **overrides):
    body = {"kind": "lost", "cat_name": "Mishmish", "description": "Orange tabby, white socks",
            "cat_type": "indoor", "home_type": "apartment", "seen_at": ago(hours=3), **AL_REEM}
    body.update(overrides)
    res = client.post("/api/cases", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def helper(n=1):
    return {"helper_id": f"helper-{n:04d}", "helper_name": f"Helper {n}"}


def test_create_and_view_lost_case(client):
    created = new_case(client)
    case = client.get(f"/api/cases/{created['slug']}").json()
    assert case["cat_name"] == "Mishmish"
    assert case["is_owner"] is False
    zone = case["zone"]
    assert (zone["core_m"], zone["likely_m"]) == (39, 137)
    assert zone["anchored_on"] == "escape"
    assert zone["stats"]["total"] == len(zone["cells"]) > 0
    assert "owner_key_hash" not in case and "lat" not in case


def test_owner_key_is_checked(client):
    created = new_case(client)
    slug = created["slug"]
    assert client.post(f"/api/cases/{slug}/status", json={"status": "reunited"}).status_code == 403
    assert client.post(f"/api/cases/{slug}/status", json={"status": "reunited"},
                       headers={"X-Owner-Key": "wrong"}).status_code == 403
    ok = client.post(f"/api/cases/{slug}/status", json={"status": "reunited"},
                     headers={"X-Owner-Key": created["owner_key"]})
    assert ok.status_code == 200
    case = client.get(f"/api/cases/{slug}", headers={"X-Owner-Key": created["owner_key"]}).json()
    assert case["status"] == "reunited" and case["is_owner"] is True
    assert client.post(f"/api/cases/{slug}/assign", json=helper()).status_code == 409


def test_rejects_future_and_naive_times(client):
    for seen_at in [ago(hours=-2), datetime.now().isoformat(), ago(days=400)]:
        body = {"kind": "lost", "cat_type": "indoor", "seen_at": seen_at, **AL_REEM}
        assert client.post("/api/cases", json=body).status_code == 422


def test_assign_gives_nearest_cells_and_is_idempotent(client):
    slug = new_case(client)["slug"]
    first = client.post(f"/api/cases/{slug}/assign", json={**helper(1), "count": 3}).json()["cells"]
    cells = client.get(f"/api/cases/{slug}").json()["zone"]["cells"]
    assert first == [c["h3"] for c in cells[:3]]
    again = client.post(f"/api/cases/{slug}/assign", json={**helper(1), "count": 3}).json()["cells"]
    assert again == first
    second = client.post(f"/api/cases/{slug}/assign", json={**helper(2), "count": 3}).json()["cells"]
    assert not set(first) & set(second)


def test_concurrent_assign_never_double_books(client):
    slug = new_case(client)["slug"]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(
            lambda n: client.post(f"/api/cases/{slug}/assign", json={**helper(n), "count": 2}).json()["cells"],
            range(8),
        ))
    flat = [c for r in results for c in r]
    assert len(flat) == len(set(flat)) == 16


def test_cell_claim_conflict_search_and_release(client):
    slug = new_case(client)["slug"]
    cell = client.get(f"/api/cases/{slug}").json()["zone"]["cells"][0]["h3"]
    url = f"/api/cases/{slug}/cells/{cell}"
    assert client.post(url, json={**helper(1), "action": "claim"}).status_code == 200
    taken = client.post(url, json={**helper(2), "action": "searched"})
    assert taken.status_code == 409 and "Helper 1" in taken.json()["detail"]
    client.post(url, json={**helper(2), "action": "release"})
    assert client.post(url, json={**helper(1), "action": "searched"}).status_code == 200
    states = {c["h3"]: c["state"] for c in client.get(f"/api/cases/{slug}").json()["zone"]["cells"]}
    assert states[cell] == "searched"
    assert client.post(f"/api/cases/{slug}/cells/8a2a1072b59ffff",
                       json={**helper(1), "action": "claim"}).status_code == 422


def test_stale_claims_free_up(client):
    from app.db import pool

    slug = new_case(client)["slug"]
    cells = client.post(f"/api/cases/{slug}/assign", json={**helper(1), "count": 2}).json()["cells"]
    with pool.connection() as conn:
        conn.execute("UPDATE cell_claims SET updated_at = now() - interval '3 hours'")
    again = client.post(f"/api/cases/{slug}/assign", json={**helper(2), "count": 2}).json()["cells"]
    assert again == cells


def test_confirmed_sighting_recentres_zone_and_rejected_is_hidden(client):
    created = new_case(client)
    slug, key = created["slug"], created["owner_key"]
    sighting = {**helper(3), "lat": AL_REEM["lat"] + 0.004, "lng": AL_REEM["lng"],
                "seen_at": ago(hours=1), "confidence": "sure", "note": "Under a car"}
    sid = client.post(f"/api/cases/{slug}/sightings", json=sighting).json()["id"]
    before = client.get(f"/api/cases/{slug}").json()["zone"]["anchor"]
    assert client.post(f"/api/cases/{slug}/sightings/{sid}/review",
                       json={"review": "confirmed"}).status_code == 403
    client.post(f"/api/cases/{slug}/sightings/{sid}/review", json={"review": "confirmed"},
                headers={"X-Owner-Key": key})
    zone = client.get(f"/api/cases/{slug}").json()["zone"]
    assert zone["anchored_on"] == "sighting" and zone["anchor"]["lat"] > before["lat"] + 0.003

    client.post(f"/api/cases/{slug}/sightings/{sid}/review", json={"review": "rejected"},
                headers={"X-Owner-Key": key})
    assert client.get(f"/api/cases/{slug}").json()["sightings"] == []
    owner_view = client.get(f"/api/cases/{slug}", headers={"X-Owner-Key": key}).json()
    assert owner_view["sightings"][0]["review"] == "rejected"


def test_far_away_sighting_rejected(client):
    slug = new_case(client)["slug"]
    body = {**helper(), "lat": 25.2, "lng": 55.27, "seen_at": ago(hours=1), "confidence": "maybe"}
    assert client.post(f"/api/cases/{slug}/sightings", json=body).status_code == 422


def test_found_report_matches_nearby_lost_case_only(client):
    lost = new_case(client, cat_type="outdoor", seen_at=ago(days=2))["slug"]
    new_case(client, cat_type="indoor", seen_at=ago(days=2), lat=AL_REEM["lat"] - 0.002)  # ~1.1 km from the found cat, too far for indoor
    found = new_case(client, kind="found", cat_name=None, seen_at=ago(hours=2),
                     lat=AL_REEM["lat"] + 0.008)["slug"]
    matches = client.get(f"/api/cases/{found}").json()["matches"]
    assert [m["slug"] for m in matches] == [lost]
    assert matches[0]["distance_m"] % 50 == 0
    assert [m["slug"] for m in client.get(f"/api/cases/{lost}").json()["matches"]] == [found]


def test_found_before_cat_was_lost_does_not_match(client):
    found = new_case(client, kind="found", seen_at=ago(days=5))["slug"]
    new_case(client, cat_type="outdoor", seen_at=ago(days=1))
    assert client.get(f"/api/cases/{found}").json()["matches"] == []


def test_near_returns_coarse_area_only(client):
    new_case(client)
    new_case(client, seen_at=ago(days=90))
    res = client.get("/api/near", params=AL_REEM).json()
    assert len(res["cases"]) == 1
    item = res["cases"][0]
    assert abs(item["area"]["lat"] - AL_REEM["lat"]) > 0 or abs(item["area"]["lng"] - AL_REEM["lng"]) > 0
    assert item["distance_m"] % 100 == 0


def jpeg_with_gps() -> bytes:
    img = Image.new("RGB", (3000, 2000), (200, 120, 40))
    exif = Image.Exif()
    exif[0x8825] = {2: (25, 4, 49), 4: (55, 8, 25)}
    exif[0x010F] = "PhoneMaker"
    out = io.BytesIO()
    img.save(out, "JPEG", exif=exif)
    return out.getvalue()


def test_photo_upload_strips_metadata_and_resizes(client):
    raw = jpeg_with_gps()
    assert Image.open(io.BytesIO(raw)).getexif()
    res = client.post("/api/photos", files={"file": ("cat.jpg", raw, "image/jpeg")}).json()
    assert max(res["width"], res["height"]) == 1280
    data = client.get(res["url"]).content
    assert not Image.open(io.BytesIO(data)).getexif()
    slug = new_case(client, photo_id=res["id"])["slug"]
    assert client.get(f"/api/cases/{slug}").json()["photo_url"] == res["url"]


def test_photo_upload_rejects_non_images(client):
    res = client.post("/api/photos", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert res.status_code == 422
    assert client.post("/api/cases", json={"kind": "lost", "seen_at": ago(hours=1),
                                           "photo_id": "00000000-0000-0000-0000-000000000000",
                                           **AL_REEM}).status_code == 422


def test_rate_limit(client):
    from app.main import write_limit

    write_limit.hits.clear()
    codes = [client.post("/api/cases", json={"kind": "lost", "seen_at": ago(hours=1), **AL_REEM}).status_code
             for _ in range(write_limit.limit + 1)]
    assert codes[-1] == 429 and codes[0] == 201
