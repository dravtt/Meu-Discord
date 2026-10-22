export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  customStatus: string;
  status: Status;
}

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
export interface Invite { code: string; server: { id: string; name: string; iconUrl: string | null; memberCount: number }; inviter: User; uses: number; maxUses: number | null; expiresAt: string | null }
