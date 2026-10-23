-- Profile customization: banner, pronouns, card colors and display name style.
ALTER TABLE users ADD COLUMN banner_url text;
ALTER TABLE users ADD COLUMN pronouns text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_colors text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN name_font text NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN name_effect text NOT NULL DEFAULT 'solid';
ALTER TABLE users ADD COLUMN name_colors text[] NOT NULL DEFAULT '{}';
