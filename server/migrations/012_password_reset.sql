ALTER TABLE users ADD COLUMN reset_code_hash text;
ALTER TABLE users ADD COLUMN reset_code_expires timestamptz;
ALTER TABLE users ADD COLUMN reset_code_tries int NOT NULL DEFAULT 0;
