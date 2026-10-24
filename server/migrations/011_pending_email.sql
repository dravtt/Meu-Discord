-- A new e-mail waiting for its code: lets old accounts add one, and anyone change theirs.
ALTER TABLE users ADD COLUMN pending_email text;
