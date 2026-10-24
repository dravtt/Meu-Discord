export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  customStatus: string;
  status: Status;
  createdAt?: string;
  bannerUrl?: string | null;
  pronouns?: string;
  /** Profile theme: one color, or two for a gradient. */
  profileColors?: string[];
  nameStyle?: NameStyle;
  /** Only on your own user and on a fetched profile. */
  widgets?: Widget[];
  /** The game being played right now. */
  activity?: Activity | null;
  /** Badges shown on the profile (already without the hidden ones, for other people). */
  badges?: string[];
  /* Only on your own user: */
  email?: string | null;
  emailVerified?: boolean;
  hasBirthdate?: boolean;
  adult?: boolean;
  usernameChangedAt?: string | null;
  hiddenBadges?: string[];
  /** Silenced by the antispam (or an admin) until this time. */
  mutedUntil?: string | null;
  isAdmin?: boolean;
}

export interface Activity { name: string; steamId?: number; catalogId?: string; source: 'manual' | 'auto'; since: string }

/** `cover` is an uploaded image; otherwise the Voka catalog cover (`catalogId`) or Steam's art (`steamId`). */
export interface Game { name: string; cover: string | null; steamId?: number; catalogId?: string }
export type Widget =
  | { type: 'favorite'; game: Game | null; note: string }
  | { type: 'games'; games: Game[] }
  | { type: 'text'; title: string; text: string };

export interface NameStyle { font: string; effect: string; colors: string[] }

export interface Channel {
  id: string;
  serverId: string | null;
  parentId: string | null;
  type: 'text' | 'voice' | 'category' | 'dm' | 'group_dm' | 'thread';
  name: string;
  topic: string;
  position: number;
  ownerId: string | null;
  lastMessageAt: string | null;
  permissions?: number;
  recipients?: User[];
  /** Group DM picture. */
  iconUrl?: string | null;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  hoist: boolean;
  isDefault: boolean;
}

export interface Member {
  serverId: string;
  user: User;
  nickname: string | null;
  joinedAt: string;
  roleIds: string[];
}

export interface Overwrite { channelId: string; targetId: string; targetType: 'role' | 'member'; allow: number; deny: number }

export interface VoiceState {
  userId: string;
  channelId: string;
  serverId: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  streaming: boolean;
}

export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  /** Adults only (+18). */
  nsfw?: boolean;
  permissions: number;
  channels: Channel[];
  roles: Role[];
  members: Member[];
  overwrites: Overwrite[];
  voiceStates: VoiceState[];
}

export interface Attachment { id: string; url: string; filename: string; size: number; contentType: string }
export interface Reaction { emoji: string; count: number; me: boolean }

export interface Message {
  id: string;
  channelId: string;
  author: User;
  content: string;
  /** 'default' for normal messages; the rest are group notices like someone leaving. */
  kind?: 'default' | 'member_add' | 'member_remove' | 'member_leave' | 'group_name' | 'group_icon';
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  threadId: string | null;
  mentionEveryone: boolean;
  mentions: string[];
  attachments: Attachment[];
  reactions: Reaction[];
  replyTo: { id: string; content?: string; authorId?: string; authorName?: string; deleted?: boolean } | null;
  /** Client-only: message is still being sent. */
  pending?: boolean;
}

export interface Relationship { user: User; type: 'friend' | 'incoming' | 'outgoing' | 'blocked' }
export interface ReadState { channelId: string; unread: boolean; mentions: number }
export interface Invite { code: string; server: { id: string; name: string; iconUrl: string | null; memberCount: number; nsfw?: boolean }; inviter: User; uses: number; maxUses: number | null; expiresAt: string | null }
