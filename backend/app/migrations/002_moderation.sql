ALTER TABLE cases ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE TABLE IF NOT EXISTS reports (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    reporter_hash text NOT NULL,
    reason text NOT NULL CHECK (reason IN ('spam', 'scam', 'offensive', 'not_a_cat', 'other')),
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (case_id, reporter_hash)
);

CREATE INDEX IF NOT EXISTS photos_created_idx ON photos (created_at);
CREATE INDEX IF NOT EXISTS cases_seen_idx ON cases (seen_at);
