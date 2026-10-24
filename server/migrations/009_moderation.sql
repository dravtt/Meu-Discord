-- Antispam punishments, the spam log, user reports, platform bans and failed-login alerts.
ALTER TABLE users ADD COLUMN muted_until timestamptz;
ALTER TABLE users ADD COLUMN banned_at timestamptz;
ALTER TABLE users ADD COLUMN banned_reason text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN failed_logins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_login_since timestamptz;
ALTER TABLE users ADD COLUMN login_alert_at timestamptz;

-- Every time someone was stopped by a spam limit ("strike") or muted for it.
CREATE TABLE spam_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  muted_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spam_log_user ON spam_log (user_id, created_at DESC);
CREATE INDEX spam_log_server ON spam_log (server_id, created_at DESC);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  message_content text NOT NULL DEFAULT '',
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status ON reports (status, created_at DESC);
