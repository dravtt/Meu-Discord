import { ActivityLine } from './Activity';
import { Crown } from 'lucide-react';
import { useStore, memberName, memberColor } from '../lib/store';
import type { Channel, Member, Server } from '../lib/types';
import { Avatar } from './Avatar';
import { openModal } from './Modal';
import { ProfileCard } from './ProfileCard';
import { userMenuProps } from './ContextMenu';
import { StyledName } from '../lib/nameStyle';

/** Online members grouped by their highest hoisted role, then everyone offline. */
export function MemberList({ server }: { server: Server; channel: Channel }) {
  const presence = useStore((s) => s.presence);
  const online = (m: Member) => (presence[m.user.id]?.status ?? 'offline') !== 'offline';
  const hoisted = server.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
  const groups: { title: string; members: Member[] }[] = [];
  const placed = new Set<string>();
  for (const role of hoisted) {
    const members = server.members.filter((m) => online(m) && !placed.has(m.user.id) && m.roleIds.includes(role.id));
    members.forEach((m) => placed.add(m.user.id));
    if (members.length) groups.push({ title: role.name, members });
  }
  groups.push({ title: 'Online', members: server.members.filter((m) => online(m) && !placed.has(m.user.id)) });
  groups.push({ title: 'Offline', members: server.members.filter((m) => !online(m)) });
  const byName = (a: Member, b: Member) => memberName(server.id, a.user).localeCompare(memberName(server.id, b.user));

  return (
    <aside className="member-list">
      {groups.filter((g) => g.members.length).map((g) => (
        <div key={g.title}>
          <div className="section-title"><span>{g.title} — {g.members.length}</span></div>
          {g.members.sort(byName).map((m) => (
            <button key={m.user.id} className={`member ${online(m) ? '' : 'offline'}`} {...userMenuProps(m.user.id, server.id)} onClick={() => openModal(<ProfileCard userId={m.user.id} serverId={server.id} />)}>
              <Avatar user={m.user} size={32} showStatus />
              <span className="member-text">
                <span style={{ color: memberColor(server.id, m.user.id) }}><StyledName user={m.user}>{memberName(server.id, m.user)}</StyledName>{server.ownerId === m.user.id && <Crown size={14} className="owner-crown" />}</span>
                {presence[m.user.id]?.activity
                  ? <ActivityLine activity={presence[m.user.id].activity!} />
                  : presence[m.user.id]?.customStatus && <small>{presence[m.user.id].customStatus}</small>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
