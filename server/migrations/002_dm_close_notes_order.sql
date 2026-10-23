-- 1:1 DMs can be closed (hidden from the list) until a new message arrives.
ALTER TABLE dm_recipients ADD COLUMN closed boolean NOT NULL DEFAULT false;

-- The order a user arranged their servers in the left rail.
ALTER TABLE users ADD COLUMN server_order uuid[] NOT NULL DEFAULT '{}';

-- Private notes about other users, visible only to the author.
CREATE TABLE user_notes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, target_id)
);
