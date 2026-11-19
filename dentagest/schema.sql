-- DentaGest DZ : base de synchronisation (Cloudflare D1)
-- Le serveur ne stocke que des données chiffrées sur l'appareil (AES-256-GCM).
-- Il ne connaît ni les mots de passe, ni la clé du cabinet.

CREATE TABLE IF NOT EXISTS cabinets (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL DEFAULT 0,      -- compteur de modifications du cabinet
  created_at  INTEGER NOT NULL,
  rec_salt    TEXT,                            -- code de secours du titulaire
  rec_auth    TEXT,
  rec_wrapped TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  cabinet_id   TEXT NOT NULL,
  login        TEXT NOT NULL UNIQUE,
  name_enc     TEXT,                           -- nom affiché, chiffré
  role         TEXT NOT NULL,                  -- owner | member
  perms        TEXT NOT NULL DEFAULT '',       -- f = caisse/devis, o = ordonnances, p = paramètres
  kdf_salt     TEXT NOT NULL,
  auth_hash    TEXT NOT NULL,
  wrapped      TEXT NOT NULL,                  -- clé du cabinet chiffrée par le mot de passe
  must_change  INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_cab ON users(cabinet_id);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  cabinet_id  TEXT NOT NULL,
  device      TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_cab ON sessions(cabinet_id);

CREATE TABLE IF NOT EXISTS records (
  cabinet_id TEXT NOT NULL,
  col        TEXT NOT NULL,
  id         TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  data       TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  t          INTEGER NOT NULL,
  by_user    TEXT,
  PRIMARY KEY (cabinet_id, col, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records(cabinet_id, seq);

CREATE TABLE IF NOT EXISTS audit (
  cabinet_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  col        TEXT NOT NULL,
  rid        TEXT NOT NULL,
  user_id    TEXT,
  action     TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_cab ON audit(cabinet_id, at);
