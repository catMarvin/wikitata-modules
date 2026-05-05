// Auto-loaded migration SQL as a string export so the package builds without
// SQL-loader bundler config. The `.sql` sibling file is the source of truth;
// keep this in sync if you edit it.

const SQL = `
-- @wikitata/content-creation v0.2.0 — initial schema
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS __SCHEMA__.cost_log (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  msg         text        NOT NULL,
  ok          boolean     NOT NULL,
  cost_usd    numeric(12, 6) NOT NULL,
  model       text        NOT NULL,
  cost_source text        NOT NULL CHECK (cost_source IN ('measured', 'estimate')),
  project     text,
  route       text,
  provider    text,
  native_unit text,
  native_amount numeric(18, 6)
);

CREATE INDEX IF NOT EXISTS cost_log_ts_idx ON __SCHEMA__.cost_log (ts DESC);
CREATE INDEX IF NOT EXISTS cost_log_project_idx ON __SCHEMA__.cost_log (project);

CREATE TABLE IF NOT EXISTS __SCHEMA__.gen_log (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  msg        text        NOT NULL,
  ok         boolean,
  archived   boolean     NOT NULL DEFAULT false,
  session_id text
);

CREATE INDEX IF NOT EXISTS gen_log_ts_idx ON __SCHEMA__.gen_log (ts DESC);
CREATE INDEX IF NOT EXISTS gen_log_archived_idx ON __SCHEMA__.gen_log (archived) WHERE archived = false;

CREATE TABLE IF NOT EXISTS __SCHEMA__.batch_spend_log (
  id             bigserial PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  seg_indices    integer[]   NOT NULL,
  seg_labels     text[]      NOT NULL,
  ok_count       integer     NOT NULL DEFAULT 0,
  err_count      integer     NOT NULL DEFAULT 0,
  cost_measured  numeric(12, 6),
  cost_estimate  numeric(12, 6),
  balance_before numeric(12, 6),
  balance_after  numeric(12, 6),
  model          text
);

CREATE INDEX IF NOT EXISTS batch_spend_log_ts_idx ON __SCHEMA__.batch_spend_log (ts DESC);
`;

export default SQL;
