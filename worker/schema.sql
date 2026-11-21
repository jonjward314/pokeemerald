-- One row per player: their latest save. "email" is the player key: the
-- sign-in email for the account's own player, or "email#id" for an extra
-- player made under it (see profiles).
CREATE TABLE IF NOT EXISTS saves (
  email TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  saved_at INTEGER NOT NULL,   -- when the game wrote it (ms since 1970, from the phone)
  updated_at INTEGER NOT NULL  -- when the server stored it
);

-- The last 20 saves per player, for rolling back by hand if something goes wrong.
CREATE TABLE IF NOT EXISTS save_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  data BLOB NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS save_history_email ON save_history (email, id);

-- Extra players on one sign-in ("Who's playing?"), for kids sharing a phone.
-- The Worker also creates this table on first use.
CREATE TABLE IF NOT EXISTS profiles (
  email TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, id)
);


-- House rules from the admin page: '*' for everyone, or one player's email.
-- (The Worker also creates this table itself if it is missing.)
CREATE TABLE IF NOT EXISTS rules (
  email TEXT PRIMARY KEY,
  data TEXT NOT NULL,          -- JSON, see RULE_DEFAULTS in worker/index.js
  updated_at INTEGER NOT NULL
);

-- Shared family logins that show a who's-playing picker (set on /admin).
CREATE TABLE IF NOT EXISTS pickers (
  email TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
