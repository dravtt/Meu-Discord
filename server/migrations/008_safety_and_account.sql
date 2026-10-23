-- E-mail verification, birth date (age-gated servers), username change cooldown,
-- badges the user chose to hide, current activity, and +18 servers.
ALTER TABLE users ADD COLUMN email text;
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
-- Accounts created before verification existed count as verified.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN email_code text;
ALTER TABLE users ADD COLUMN email_code_expires timestamptz;
ALTER TABLE users ADD COLUMN email_code_tries int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN birthdate date;
ALTER TABLE users ADD COLUMN username_changed_at timestamptz;
ALTER TABLE users ADD COLUMN hidden_badges text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN activity jsonb;
ALTER TABLE servers ADD COLUMN nsfw boolean NOT NULL DEFAULT false;
