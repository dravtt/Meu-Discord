import { Fragment, type ReactNode } from 'react';
import { findChannel, get, memberName } from './store';

/**
 * Small, safe message formatter: code blocks, inline code, **bold**, *italic*, __underline__,
 * ~~strike~~, ||spoiler||, links, <@user> mentions, <#channel> links and @everyone. Builds React
 * nodes directly, never HTML strings.
 */
export function renderContent(text: string, serverId: string | null, onChannel?: (id: string) => void): ReactNode {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      const body = part.slice(3, -3).replace(/^[a-z0-9]*\n/i, '');
      return <pre key={i} className="codeblock"><code>{body}</code></pre>;
    }
    return <Fragment key={i}>{inline(part, serverId, onChannel)}</Fragment>;
  });
}

const TOKEN = /(`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\|\|[^|]+\|\||<@[0-9a-f-]{36}>|<#[0-9a-f-]{36}>|@everyone|@here|https?:\/\/[^\s<]+)/g;

function inline(text: string, serverId: string | null, onChannel?: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const t = match[0];
    const start = match.index!;
    if (start > last) out.push(text.slice(last, start));
    last = start + t.length;
    const k = key++;
    if (t.startsWith('`')) out.push(<code key={k} className="inline-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), serverId, onChannel)}</strong>);
    else if (t.startsWith('__')) out.push(<u key={k}>{inline(t.slice(2, -2), serverId, onChannel)}</u>);
    else if (t.startsWith('~~')) out.push(<s key={k}>{inline(t.slice(2, -2), serverId, onChannel)}</s>);
    else if (t.startsWith('||')) out.push(<Spoiler key={k}>{inline(t.slice(2, -2), serverId, onChannel)}</Spoiler>);
    else if (t.startsWith('*') || t.startsWith('_')) out.push(<em key={k}>{inline(t.slice(1, -1), serverId, onChannel)}</em>);
    else if (t.startsWith('<@')) {
      const id = t.slice(2, -1);
      const s = get();
      const user = s.servers[serverId ?? '']?.members.find((m) => m.user.id === id)?.user
        ?? Object.values(s.dms).flatMap((d) => d.recipients ?? []).find((u) => u.id === id)
        ?? s.relationships.find((r) => r.user.id === id)?.user;
      out.push(<span key={k} className={`mention ${id === s.me?.id ? 'me' : ''}`}>@{user ? memberName(serverId, user) : 'usuário'}</span>);
    } else if (t.startsWith('<#')) {
      const ch = findChannel(t.slice(2, -1));
      out.push(<span key={k} className="mention channel" onClick={() => ch && onChannel?.(ch.id)}>#{ch?.name ?? 'canal'}</span>);
    } else if (t.startsWith('@')) out.push(<span key={k} className="mention">{t}</span>);
    else out.push(<a key={k} href={t} target="_blank" rel="noreferrer noopener">{t}</a>);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Spoiler({ children }: { children: ReactNode }) {
  return <span className="spoiler" onClick={(e) => e.currentTarget.classList.add('revealed')}>{children}</span>;
}
