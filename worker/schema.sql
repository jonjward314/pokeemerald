-- One row per player: their latest save.
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
