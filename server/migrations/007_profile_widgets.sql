-- Profile "mural": favorite game, games I like… (shape validated by the API).
ALTER TABLE users ADD COLUMN widgets jsonb NOT NULL DEFAULT '[]';
