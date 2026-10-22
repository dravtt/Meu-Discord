CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  avatar_url text,
  bio text NOT NULL DEFAULT '',
  custom_status text NOT NULL DEFAULT '',
  -- Preferred status; actual presence is online only while a socket is connected.
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per ordered pair. 'pending' rows are outgoing requests from user_id.
CREATE TABLE relationships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('friend', 'pending', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon_url text,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE bans (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

-- The @everyone role has is_default = true and applies to every member implicitly.
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#99aab5',
  permissions bigint NOT NULL DEFAULT 0,
  position int NOT NULL DEFAULT 0,
  hoist boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false
);

CREATE TABLE member_roles (
  server_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES members(server_id, user_id) ON DELETE CASCADE
);

CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  -- Categories are channels of type 'category'; other channels may point at one.
  parent_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('text', 'voice', 'category', 'dm', 'group_dm', 'thread')),
  name text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channels_server_idx ON channels(server_id);

-- Per-channel permission overwrites for a role (target_type 'role') or a member ('member').
CREATE TABLE overwrites (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('role', 'member')),
  allow bigint NOT NULL DEFAULT 0,
  deny bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE dm_recipients (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  mention_everyone boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  thread_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at timestamptz
);
CREATE INDEX messages_channel_idx ON messages(channel_id, created_at DESC);
CREATE INDEX messages_search_idx ON messages USING gin (to_tsvector('simple', content));

CREATE TABLE message_mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url text NOT NULL,
  filename text NOT NULL,
  size int NOT NULL,
  content_type text NOT NULL
);

CREATE TABLE reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE read_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE invites (
  code text PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uses int NOT NULL DEFAULT 0,
  max_uses int,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
