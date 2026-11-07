import hashlib
import hmac
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import h3
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import og, photos, security
from .db import migrate, pool
from .maintenance import Cleaner
from .ratelimit import RateLimiter
from .zone import PROFILES, STUDY_URL, distance_m, snap, zone_cells

CLAIM_TTL = timedelta(hours=2)
NEAR_RADIUS_M = 5000
NEAR_MAX_AGE = timedelta(days=60)
AREA_RESOLUTION = 8
FOUND_RESOLUTION = 10
SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
HIDE_AFTER_REPORTS = int(os.environ.get("HIDE_AFTER_REPORTS", "3"))
REPORT_SALT = os.environ.get("REPORT_SALT") or secrets.token_hex(16)
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

write_limit = RateLimiter(limit=60, window_s=60)
upload_limit = RateLimiter(limit=20, window_s=60)
report_limit = RateLimiter(limit=10, window_s=3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    migrate()
    cleaner = Cleaner(float(os.environ.get("CLEANUP_INTERVAL_S", "3600"))).start()
    yield
    cleaner.close()
    pool.close()


app = FastAPI(title="Furprint", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
security.install(app)


def now() -> datetime:
    return datetime.now(timezone.utc)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def photo_url(photo_id) -> str | None:
    return f"/api/photos/{photo_id}" if photo_id else None


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


def check_seen_at(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("seen_at needs a timezone")
    if value > now() + timedelta(minutes=10):
        raise ValueError("seen_at is in the future")
    if value < now() - timedelta(days=365):
        raise ValueError("seen_at is more than a year ago")
    return value


class CaseIn(Point):
    kind: Literal["lost", "found"]
    cat_name: str | None = Field(default=None, max_length=40)
    description: str = Field(default="", max_length=500)
    cat_type: Literal["indoor", "outdoor", "unknown"] = "unknown"
    home_type: Literal["apartment", "villa", "other"] = "other"
    seen_at: datetime
    photo_id: uuid.UUID | None = None

    _seen = field_validator("seen_at")(check_seen_at)


class Helper(BaseModel):
    helper_id: str = Field(min_length=8, max_length=64)
    helper_name: str = Field(min_length=1, max_length=40)


class SightingIn(Point, Helper):
    seen_at: datetime
    confidence: Literal["sure", "maybe"]
    note: str = Field(default="", max_length=300)
    photo_id: uuid.UUID | None = None

    _seen = field_validator("seen_at")(check_seen_at)


class AssignIn(Helper):
    count: int = Field(default=3, ge=1, le=6)


class CellIn(Helper):
    action: Literal["claim", "searched", "release"]


class ReviewIn(BaseModel):
    review: Literal["confirmed", "rejected", "pending"]


class StatusIn(BaseModel):
    status: Literal["open", "reunited", "closed"]


class ReportIn(BaseModel):
    reason: Literal["spam", "scam", "offensive", "not_a_cat", "other"]
    note: str = Field(default="", max_length=300)


def load_case(conn, slug: str) -> dict:
    case = conn.execute("SELECT * FROM cases WHERE slug = %s", (slug,)).fetchone()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def is_owner(case: dict, key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(case["owner_key_hash"], hash_key(key))


def require_owner(case: dict, key: str | None) -> None:
    if not is_owner(case, key):
        raise HTTPException(403, "Only the person who reported this cat can do that")


def require_open_lost(case: dict) -> None:
    if case["kind"] != "lost":
        raise HTTPException(400, "Only lost-cat cases have a search")
    if case["status"] != "open":
        raise HTTPException(409, "This case is closed")


def anchor_for(conn, case: dict) -> tuple[float, float, str | None]:
    row = conn.execute(
        """SELECT id, lat, lng FROM sightings
           WHERE case_id = %s AND review = 'confirmed'
           ORDER BY seen_at DESC LIMIT 1""",
        (case["id"],),
    ).fetchone()
    if row:
        return row["lat"], row["lng"], str(row["id"])
    return case["lat"], case["lng"], None


def live_claims(conn, case_id) -> dict[str, dict]:
    rows = conn.execute(
        """SELECT h3, helper_id, helper_name, state FROM cell_claims
           WHERE case_id = %s AND (state = 'searched' OR updated_at > %s)""",
        (case_id, now() - CLAIM_TTL),
    ).fetchall()
    return {r["h3"]: r for r in rows}


def build_zone(conn, case: dict) -> dict:
    lat, lng, sighting_id = anchor_for(conn, case)
    profile = PROFILES[case["cat_type"]]
    cells = zone_cells(lat, lng, case["cat_type"])
    claims = live_claims(conn, case["id"])
    out, claimed, searched = [], 0, 0
    for c in cells:
        claim = claims.get(c.h3)
        state = claim["state"] if claim else "open"
        claimed += state == "claimed"
        searched += state == "searched"
        out.append({
            "h3": c.h3,
            "ring": c.ring,
            "distance_m": c.distance_m,
            "state": state,
            "helper_name": claim["helper_name"] if claim else None,
            "helper_id": claim["helper_id"] if claim else None,
        })
    anchor_lat, anchor_lng = snap(lat, lng, profile.resolution)
    return {
        "anchor": {"lat": anchor_lat, "lng": anchor_lng},
        "anchored_on": "sighting" if sighting_id else "escape",
        "anchor_sighting_id": sighting_id,
        "core_m": profile.core_m,
        "likely_m": profile.likely_m,
        "resolution": profile.resolution,
        "sample_size": profile.sample_size,
        "source_url": STUDY_URL,
        "cells": out,
        "stats": {"total": len(out), "claimed": claimed, "searched": searched},
    }


def summary(row: dict, distance: float | None = None) -> dict:
    return {
        "slug": row["slug"],
        "kind": row["kind"],
        "cat_name": row["cat_name"],
        "description": row["description"],
        "cat_type": row["cat_type"],
        "seen_at": row["seen_at"],
        "photo_url": photo_url(row["photo_id"]),
        "distance_m": None if distance is None else int(round(distance / 50) * 50),
    }


def find_matches(conn, case: dict) -> list[dict]:
    """Open cases of the opposite kind whose timing fits and that lie inside the
    lost cat's 75th-percentile distance."""
    likely = "CASE l.cat_type WHEN 'indoor' THEN 137 WHEN 'outdoor' THEN 1609 ELSE 500 END"
    if case["kind"] == "lost":
        sql = f"""SELECT f.*, ST_Distance(f.geog, l.geog) AS dist
                  FROM cases l JOIN cases f ON f.kind = 'found' AND f.status = 'open' AND f.hidden_at IS NULL
                  WHERE l.id = %s AND ST_DWithin(f.geog, l.geog, {likely})
                    AND f.seen_at >= l.seen_at - interval '1 day'
                  ORDER BY dist LIMIT 10"""
    else:
        sql = f"""SELECT l.*, ST_Distance(l.geog, f.geog) AS dist
                  FROM cases f JOIN cases l ON l.kind = 'lost' AND l.status = 'open' AND l.hidden_at IS NULL
                  WHERE f.id = %s AND ST_DWithin(l.geog, f.geog, {likely})
                    AND l.seen_at <= f.seen_at + interval '1 day'
                  ORDER BY dist LIMIT 10"""
    return [summary(r, r["dist"]) for r in conn.execute(sql, (case["id"],)).fetchall()]


def case_view(conn, case: dict, owner: bool) -> dict:
    resolution = PROFILES[case["cat_type"]].resolution if case["kind"] == "lost" else FOUND_RESOLUTION
    area_lat, area_lng = snap(case["lat"], case["lng"], resolution)
    view = {
        **summary(case),
        "status": case["status"],
        "home_type": case["home_type"],
        "created_at": case["created_at"],
        "resolved_at": case["resolved_at"],
        "area": {"lat": area_lat, "lng": area_lng},
        "is_owner": owner,
        "hidden": case["hidden_at"] is not None,
        "matches": find_matches(conn, case) if case["status"] == "open" else [],
        "zone": None,
        "sightings": [],
    }
    if case["kind"] == "lost":
        view["zone"] = build_zone(conn, case)
        hidden = "" if owner else "AND review <> 'rejected'"
        rows = conn.execute(
            f"""SELECT * FROM sightings WHERE case_id = %s {hidden}
                ORDER BY seen_at DESC LIMIT 200""",
            (case["id"],),
        ).fetchall()
        view["sightings"] = [{
            "id": str(r["id"]),
            "lat": r["lat"],
            "lng": r["lng"],
            "seen_at": r["seen_at"],
            "confidence": r["confidence"],
            "note": r["note"],
            "photo_url": photo_url(r["photo_id"]),
            "helper_name": r["helper_name"],
            "review": r["review"],
        } for r in rows]
    return view


@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


@app.post("/api/photos", dependencies=[Depends(upload_limit)])
async def upload_photo(file: UploadFile = File(...)):
    raw = await file.read(photos.MAX_BYTES + 1)
    try:
        data, width, height = photos.clean(raw)
    except photos.InvalidPhoto as exc:
        raise HTTPException(422, str(exc)) from exc
    photo_id = uuid.uuid4()
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO photos (id, data, width, height) VALUES (%s, %s, %s, %s)",
            (photo_id, data, width, height),
        )
    return {"id": str(photo_id), "url": photo_url(photo_id), "width": width, "height": height}


@app.get("/api/photos/{photo_id}")
def get_photo(photo_id: uuid.UUID):
    with pool.connection() as conn:
        row = conn.execute("SELECT data FROM photos WHERE id = %s", (photo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Photo not found")
    return Response(
        bytes(row["data"]),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.post("/api/cases", status_code=201, dependencies=[Depends(write_limit)])
def create_case(body: CaseIn):
    owner_key = secrets.token_urlsafe(24)
    with pool.connection() as conn:
        if body.photo_id and not conn.execute(
            "SELECT 1 FROM photos WHERE id = %s", (body.photo_id,)
        ).fetchone():
            raise HTTPException(422, "Unknown photo")
        for _ in range(5):
            slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(8))
            row = conn.execute(
                """INSERT INTO cases (id, slug, owner_key_hash, kind, cat_name, description,
                       cat_type, home_type, lat, lng, seen_at, photo_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (slug) DO NOTHING RETURNING slug""",
                (uuid.uuid4(), slug, hash_key(owner_key), body.kind,
                 (body.cat_name or "").strip() or None, body.description.strip(),
                 body.cat_type, body.home_type, body.lat, body.lng, body.seen_at, body.photo_id),
            ).fetchone()
            if row:
                return {"slug": slug, "owner_key": owner_key}
    raise HTTPException(500, "Could not allocate a case link, try again")


@app.get("/api/cases/{slug}")
def get_case(slug: str, x_owner_key: str | None = Header(default=None)):
    with pool.connection() as conn:
        case = load_case(conn, slug)
        owner = is_owner(case, x_owner_key)
        if case["hidden_at"] and not owner:
            raise HTTPException(410, "This case was hidden after reports from the community")
        return case_view(conn, case, owner)


def delete_case_rows(conn, case_id) -> None:
    photo_ids = [r["photo_id"] for r in conn.execute(
        """SELECT photo_id FROM cases WHERE id = %(id)s AND photo_id IS NOT NULL
           UNION SELECT photo_id FROM sightings WHERE case_id = %(id)s AND photo_id IS NOT NULL""",
        {"id": case_id},
    ).fetchall()]
    conn.execute("DELETE FROM cases WHERE id = %s", (case_id,))
    if photo_ids:
        conn.execute("DELETE FROM photos WHERE id = ANY(%s)", (photo_ids,))


@app.delete("/api/cases/{slug}")
def delete_case(slug: str, x_owner_key: str | None = Header(default=None)):
    """Owner removes the case with every photo, sighting and claim attached to it."""
    with pool.connection() as conn, conn.transaction():
        case = load_case(conn, slug)
        require_owner(case, x_owner_key)
        delete_case_rows(conn, case["id"])
    return {"ok": True}


@app.post("/api/cases/{slug}/report", dependencies=[Depends(report_limit)])
def report_case(slug: str, body: ReportIn, request: Request):
    """Each IP counts once per case; enough distinct reporters hide the case
    until an admin reviews it."""
    ip = request.client.host if request.client else "unknown"
    reporter = hmac.new(REPORT_SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()
    with pool.connection() as conn, conn.transaction():
        case = load_case(conn, slug)
        conn.execute(
            """INSERT INTO reports (id, case_id, reporter_hash, reason, note) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (case_id, reporter_hash) DO NOTHING""",
            (uuid.uuid4(), case["id"], reporter, body.reason, body.note.strip()),
        )
        count = conn.execute("SELECT count(*) AS n FROM reports WHERE case_id = %s", (case["id"],)).fetchone()["n"]
        if count >= HIDE_AFTER_REPORTS:
            conn.execute("UPDATE cases SET hidden_at = coalesce(hidden_at, now()) WHERE id = %s", (case["id"],))
    return {"ok": True}


def require_admin(authorization: str | None = Header(default=None)) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(404)
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {ADMIN_TOKEN}"):
        raise HTTPException(401, "Admin token required")


@app.get("/api/admin/reports", dependencies=[Depends(require_admin)])
def admin_reports():
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT c.slug, c.kind, c.cat_name, c.description, c.hidden_at, c.created_at,
                      count(r.id) AS reports, array_agg(DISTINCT r.reason) AS reasons,
                      array_remove(array_agg(r.note), '') AS notes
               FROM cases c JOIN reports r ON r.case_id = c.id
               GROUP BY c.id ORDER BY max(r.created_at) DESC LIMIT 200"""
        ).fetchall()
    return {"cases": rows}


@app.post("/api/admin/cases/{slug}/{action}", dependencies=[Depends(require_admin)])
def admin_action(slug: str, action: Literal["hide", "restore", "delete"]):
    with pool.connection() as conn, conn.transaction():
        case = load_case(conn, slug)
        if action == "delete":
            delete_case_rows(conn, case["id"])
        elif action == "hide":
            conn.execute("UPDATE cases SET hidden_at = coalesce(hidden_at, now()) WHERE id = %s", (case["id"],))
        else:
            conn.execute("UPDATE cases SET hidden_at = NULL WHERE id = %s", (case["id"],))
            conn.execute("DELETE FROM reports WHERE case_id = %s", (case["id"],))
    return {"ok": True}


@app.post("/api/cases/{slug}/assign", dependencies=[Depends(write_limit)])
def assign_cells(slug: str, body: AssignIn):
    """Give a helper the nearest unclaimed cells; serialised per case so two
    helpers pressing the button at once never get the same street."""
    with pool.connection() as conn, conn.transaction():
        case = load_case(conn, slug)
        require_open_lost(case)
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(case["id"]),))
        lat, lng, _ = anchor_for(conn, case)
        cells = zone_cells(lat, lng, case["cat_type"])
        claims = live_claims(conn, case["id"])
        mine = [c.h3 for c in cells
                if (cl := claims.get(c.h3)) and cl["state"] == "claimed"
                and cl["helper_id"] == body.helper_id]
        wanted = [c.h3 for c in cells if c.h3 not in claims][: max(0, body.count - len(mine))]
        for cell in wanted:
            conn.execute(
                """INSERT INTO cell_claims (case_id, h3, helper_id, helper_name, state, updated_at)
                   VALUES (%s, %s, %s, %s, 'claimed', now())
                   ON CONFLICT (case_id, h3) DO UPDATE SET helper_id = EXCLUDED.helper_id,
                       helper_name = EXCLUDED.helper_name, state = 'claimed', updated_at = now()""",
                (case["id"], cell, body.helper_id, body.helper_name),
            )
        return {"cells": mine + wanted}


@app.post("/api/cases/{slug}/cells/{cell}", dependencies=[Depends(write_limit)])
def update_cell(slug: str, cell: str, body: CellIn, x_owner_key: str | None = Header(default=None)):
    with pool.connection() as conn, conn.transaction():
        case = load_case(conn, slug)
        require_open_lost(case)
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(case["id"]),))
        lat, lng, _ = anchor_for(conn, case)
        if cell not in {c.h3 for c in zone_cells(lat, lng, case["cat_type"])}:
            raise HTTPException(422, "That area is outside the search zone")
        claim = live_claims(conn, case["id"]).get(cell)
        theirs = claim and claim["helper_id"] != body.helper_id
        if body.action == "release":
            if claim and claim["state"] == "claimed" and (not theirs or is_owner(case, x_owner_key)):
                conn.execute("DELETE FROM cell_claims WHERE case_id = %s AND h3 = %s", (case["id"], cell))
            return {"ok": True}
        if claim and claim["state"] == "searched":
            return {"ok": True}
        if theirs:
            raise HTTPException(409, f"{claim['helper_name']} is already searching there")
        state = "claimed" if body.action == "claim" else "searched"
        conn.execute(
            """INSERT INTO cell_claims (case_id, h3, helper_id, helper_name, state, updated_at)
               VALUES (%s, %s, %s, %s, %s, now())
               ON CONFLICT (case_id, h3) DO UPDATE SET helper_id = EXCLUDED.helper_id,
                   helper_name = EXCLUDED.helper_name, state = EXCLUDED.state, updated_at = now()""",
            (case["id"], cell, body.helper_id, body.helper_name, state),
        )
        return {"ok": True}


@app.post("/api/cases/{slug}/sightings", status_code=201, dependencies=[Depends(write_limit)])
def add_sighting(slug: str, body: SightingIn):
    with pool.connection() as conn:
        case = load_case(conn, slug)
        require_open_lost(case)
        if distance_m((case["lat"], case["lng"]), (body.lat, body.lng)) > 25_000:
            raise HTTPException(422, "That spot is more than 25 km from where the cat was lost")
        sighting_id = uuid.uuid4()
        conn.execute(
            """INSERT INTO sightings (id, case_id, lat, lng, seen_at, confidence, note,
                   photo_id, helper_id, helper_name)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (sighting_id, case["id"], body.lat, body.lng, body.seen_at, body.confidence,
             body.note.strip(), body.photo_id, body.helper_id, body.helper_name),
        )
    return {"id": str(sighting_id)}


@app.post("/api/cases/{slug}/sightings/{sighting_id}/review")
def review_sighting(slug: str, sighting_id: uuid.UUID, body: ReviewIn,
                    x_owner_key: str | None = Header(default=None)):
    with pool.connection() as conn:
        case = load_case(conn, slug)
        require_owner(case, x_owner_key)
        row = conn.execute(
            "UPDATE sightings SET review = %s WHERE id = %s AND case_id = %s RETURNING id",
            (body.review, sighting_id, case["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Sighting not found")
    return {"ok": True}


@app.post("/api/cases/{slug}/status")
def set_status(slug: str, body: StatusIn, x_owner_key: str | None = Header(default=None)):
    with pool.connection() as conn:
        case = load_case(conn, slug)
        require_owner(case, x_owner_key)
        conn.execute(
            "UPDATE cases SET status = %s, resolved_at = %s WHERE id = %s",
            (body.status, None if body.status == "open" else now(), case["id"]),
        )
    return {"ok": True}


@app.get("/api/near")
def near(lat: float, lng: float):
    """Open cases nearby, with location reduced to a ~0.7 km² area."""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Bad coordinates")
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT *, ST_Distance(geog, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography) AS dist
               FROM cases
               WHERE status = 'open' AND hidden_at IS NULL AND seen_at > %(since)s
                 AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography, %(r)s)
               ORDER BY seen_at DESC LIMIT 50""",
            {"lat": lat, "lng": lng, "r": NEAR_RADIUS_M, "since": now() - NEAR_MAX_AGE},
        ).fetchall()
    out = []
    for r in rows:
        area_lat, area_lng = h3.cell_to_latlng(h3.latlng_to_cell(r["lat"], r["lng"], AREA_RESOLUTION))
        out.append({**summary(r), "distance_m": int(round(r["dist"] / 100) * 100),
                    "area": {"lat": area_lat, "lng": area_lng}})
    return {"cases": out, "radius_m": NEAR_RADIUS_M}


DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

@app.get("/robots.txt", include_in_schema=False)
def robots():
    return PlainTextResponse("User-agent: *\nDisallow: /api/\n")


if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    INDEX = (DIST / "index.html").read_text()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str, request: Request):
        if path.startswith("api/"):
            raise HTTPException(404)
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            cache = "no-cache" if target.name in {"sw.js", "registerSW.js", "manifest.webmanifest"} else "public, max-age=3600"
            return FileResponse(target, headers={"Cache-Control": cache})
        body = INDEX
        parts = path.strip("/").split("/")
        if len(parts) in (2, 3) and parts[0] == "c":
            meta = og.page_meta(parts[1], str(request.base_url))
            if meta:
                body = og.inject(INDEX, meta)
        return HTMLResponse(body, headers={"Cache-Control": "no-cache"})
