CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS photos (
    id uuid PRIMARY KEY,
    data bytea NOT NULL,
    width int NOT NULL,
    height int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    owner_key_hash text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('lost', 'found')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reunited', 'closed')),
    cat_name text,
    description text NOT NULL DEFAULT '',
    cat_type text NOT NULL CHECK (cat_type IN ('indoor', 'outdoor', 'unknown')),
    home_type text NOT NULL CHECK (home_type IN ('apartment', 'villa', 'other')),
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    geog geography(Point, 4326) GENERATED ALWAYS AS
        (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
    seen_at timestamptz NOT NULL,
    photo_id uuid REFERENCES photos(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS cases_geog_idx ON cases USING gist (geog);
CREATE INDEX IF NOT EXISTS cases_open_idx ON cases (kind, status);

CREATE TABLE IF NOT EXISTS sightings (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    seen_at timestamptz NOT NULL,
    confidence text NOT NULL CHECK (confidence IN ('sure', 'maybe')),
    note text NOT NULL DEFAULT '',
    photo_id uuid REFERENCES photos(id),
    helper_id text NOT NULL,
    helper_name text NOT NULL,
    review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'confirmed', 'rejected')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sightings_case_idx ON sightings (case_id, seen_at DESC);

CREATE TABLE IF NOT EXISTS cell_claims (
    case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    h3 text NOT NULL,
    helper_id text NOT NULL,
    helper_name text NOT NULL,
    state text NOT NULL CHECK (state IN ('claimed', 'searched')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, h3)
);
