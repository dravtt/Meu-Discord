-- Short sounds anyone in a call can play for everyone ("efeitos sonoros").
CREATE TABLE soundboard_sounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '',
  url text NOT NULL,
  volume real NOT NULL DEFAULT 1,
  uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX soundboard_sounds_server_idx ON soundboard_sounds(server_id, created_at);
