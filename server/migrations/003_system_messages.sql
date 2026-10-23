-- System notices in group DMs ("X saiu do grupo"). 'default' is a normal message.
ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'default'
  CHECK (kind IN ('default', 'member_add', 'member_remove', 'member_leave', 'group_name'));
