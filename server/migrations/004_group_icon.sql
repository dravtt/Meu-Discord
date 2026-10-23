-- Group DMs can have their own picture.
ALTER TABLE channels ADD COLUMN icon_url text;
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('default', 'member_add', 'member_remove', 'member_leave', 'group_name', 'group_icon'));
