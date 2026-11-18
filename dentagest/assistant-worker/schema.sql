-- DentaGest DZ — Assistante IA (base D1)
-- Un cabinet = un appareil DentaGest (code DG-XXXX-XXXX) avec une licence Pro.

CREATE TABLE IF NOT EXISTS cabinets (
  device      TEXT PRIMARY KEY,          -- DG-XXXX-XXXX
  lic_end     TEXT NOT NULL,             -- fin de la licence Pro (AAAA-MM-JJ)
  profile     TEXT NOT NULL DEFAULT '{}',-- infos du cabinet envoyées par l'application (JSON)
  busy        TEXT NOT NULL DEFAULT '[]',-- créneaux occupés [{d,h,m}] : date, heure, durée — sans nom de patient
  enabled     INTEGER NOT NULL DEFAULT 0,-- l'assistante répond-elle ?
  wa_phone_id TEXT UNIQUE,               -- identifiant WhatsApp Cloud API du numéro du cabinet
  wa_display  TEXT,                      -- numéro affiché (ex. +213 555 12 34 56)
  synced_at   INTEGER,                   -- dernière synchronisation de l'agenda (ms)
  created_at  INTEGER NOT NULL
);

-- Une conversation WhatsApp par patient et par cabinet
CREATE TABLE IF NOT EXISTS conversations (
  device     TEXT NOT NULL,
  wa_user    TEXT NOT NULL,              -- numéro WhatsApp du patient (format international sans +)
  messages   TEXT NOT NULL DEFAULT '[]', -- historique pour Claude (JSON, en ajout seulement)
  lock_until INTEGER NOT NULL DEFAULT 0, -- évite que deux messages soient traités en même temps
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device, wa_user)
);

-- Messages reçus en attente de traitement (le patient écrit souvent 2-3 messages d'affilée)
CREATE TABLE IF NOT EXISTS inbox (
  wa_msg_id TEXT PRIMARY KEY,            -- identifiant WhatsApp : sert aussi à ignorer les doublons
  device    TEXT NOT NULL,
  wa_user   TEXT NOT NULL,
  name      TEXT,
  body      TEXT NOT NULL,
  at        INTEGER NOT NULL,
  done      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inbox_pending ON inbox (device, wa_user, done);

-- Demandes créées par l'assistante, récupérées par l'application
CREATE TABLE IF NOT EXISTS requests (
  id         TEXT PRIMARY KEY,
  device     TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- rdv | annulation | message | urgence
  nom        TEXT,
  tel        TEXT,
  wa_user    TEXT,
  date       TEXT,                       -- AAAA-MM-JJ (rdv)
  heure      TEXT,                       -- HH:MM (rdv)
  duree      INTEGER,
  motif      TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL,
  pulled_at  INTEGER                     -- NULL tant que l'application ne l'a pas récupérée
);
CREATE INDEX IF NOT EXISTS requests_device ON requests (device, pulled_at);
