-- Weekly play time (for the "most played this week" widget) and the Beta badge.
ALTER TABLE users ADD COLUMN beta boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN last_play_at timestamptz;
ALTER TABLE users ADD COLUMN last_play_key text;

-- Minutes played per game, per person, per week (the week starts on Monday).
CREATE TABLE game_play (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week date NOT NULL,
  game_key text NOT NULL,
  name text NOT NULL,
  steam_id int,
  catalog_id text,
  minutes numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week, game_key)
);
CREATE INDEX game_play_top ON game_play (user_id, week, minutes DESC);
