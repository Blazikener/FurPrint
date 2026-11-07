# Furprint

**Turn neighbours into a search party for a lost cat.**

An owner reports a lost cat in under two minutes. Furprint draws a search zone based on how far lost cats actually travel, splits it into small hexagon areas, and gives the owner one link to share. Anyone who opens the link can take a few areas, mark them searched, or drop a sighting pin, with no app or account. Starting in the UAE.

## Why the zone looks like this

The zone comes from [Huang et al., 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5789300/), a study of 1,210 missing cats. Distances are from the escape point to where cats were found alive:

| Cat | Half were found within | Three in four within | Cell size |
| --- | --- | --- | --- |
| Indoor only (n=164) | 39 m | 137 m | H3 res 11 (~30 m) |
| Goes outside (n=150) | 300 m | 1,609 m | H3 res 9 (~180 m) |
| Not sure (n=477) | 50 m | 500 m | H3 res 10 (~65 m) |

- **Rings:** the core ring is searched first, then the wider ring.
- **No growth over time:** the study doesn't report distance against time missing, so the zone doesn't grow with time.
- **Re-centring:** when the owner confirms a sighting, the zone re-centres there.

The model is in `backend/app/zone.py`.

## What it does

- **Lost report:** photo, escape point, indoor/outdoor, home type and time, giving a live search zone and a share link.
- **Search party:**
  - "Join the search" gives you the 3 nearest open areas. Concurrent joins are serialised per case, so two people never get the same area.
  - Areas someone claims but doesn't finish free up after 2 hours.
- **Sightings:** helpers drop a pin, with a photo and how sure they are. The owner confirms or rejects each one, and rejected sightings are hidden from everyone else.
- **Found report:** matched against open lost reports whose zone contains it and whose timing fits.
- **Flyer:** printable A4 with a QR code, in English, Arabic, Hindi, Urdu and Tagalog.
- **Checklists:** by home type (stairwells and parking levels for apartments; AC units and gardens for villas).

## Privacy and safety

- **Photos:** re-encoded server-side, which strips EXIF, including GPS.
- **No home pin:** public pages never show the escape point. The zone is centred on the H3 cell centre.
- **"Cats near me":** shows only a ~0.7 km² area and a distance rounded to 100 m.
- **Owner access:** no accounts. The owner gets a random key, stored only as a SHA-256 hash, and kept in their browser and a private link.
- **Not included on purpose:**
  - Donations: unlicensed fundraising is a criminal offence in the UAE.
  - Prompts to feed strays: banned in Dubai.
  - Rewards for finders: they attract scams.
- **Scam warning:** every case page warns people never to pay someone who claims to have the cat.

## Production

- **Migrations:** numbered SQL files in `backend/app/migrations`, applied once each at startup under an advisory lock (`schema_migrations` table).
- **Retention:** an hourly job deletes cases 30 days after they close, open cases with no update for 180 days, and unattached photos after a day.
- **Abuse:**
  - Writes are rate-limited per IP.
  - Three distinct reporters hide a case until an admin restores it (`/api/admin/reports`, `ADMIN_TOKEN`).
  - Owners can delete a case and every photo attached to it.
- **Security headers:** strict CSP (self plus OpenFreeMap tiles), HSTS on HTTPS, `noindex` on case pages and the API.
- **Owner key:** the private owner link keeps the key in the URL fragment, so it never reaches server logs.
- **Link previews:** `/c/<slug>` is served with Open Graph tags (cat photo and name), so links shared on WhatsApp show the photo.
- **Deploy:** `render.yaml` (Docker, health check `/api/health`). The `keepalive` workflow pings the app every 10 minutes once the repo variable `FURPRINT_URL` is set.

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres with PostGIS |
| `ADMIN_TOKEN` | enables `/api/admin/*` (Bearer token); unset = admin API off |
| `REPORT_SALT` | salt for hashing reporter IPs |
| `DB_POOL_SIZE`, `CLEANUP_INTERVAL_S`, `HIDE_AFTER_REPORTS`, `LOG_LEVEL` | tuning |

## Run it

```bash
docker compose up --build        # app on http://localhost:8000
```

Development, with hot reload:

```bash
docker compose up -d db
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api
```

Tests:

```bash
cd backend && uv run pytest        # needs the db service (port 5433)
cd frontend && npx vitest run && npm run build
```

## Stack

FastAPI · Postgres + PostGIS (geography queries) · H3 · React + Vite PWA · Motion · MapLibre with [OpenFreeMap](https://openfreemap.org) tiles (no API key). It's a single container, and photos are stored in Postgres, so there's no object storage to set up.

## Not built yet

- Push or email alerts to helpers nearby (iOS web push needs the app on the home screen).
- Photo matching between found cats and lost reports.
- An admin web console (moderation is API-only for now).
- The non-English flyer lines need a review by native speakers.

## License

[AGPL-3.0](LICENSE)
