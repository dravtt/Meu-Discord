import { useEffect, useRef, useState } from 'react';

const GROUPS: Record<string, string> = {
  'Rostos': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖',
  'Gestos': '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🙏 💪 🫡 🫶',
  'Corações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝',
  'Coisas': '🔥 ✨ ⭐ 🌟 💯 ✅ ❌ ⚠️ ❓ ❗ 🎉 🎊 🎁 🏆 🥇 🎮 🎧 🎵 📌 📎 💡 🔔 💬 👀 🧠 🚀 ⏰ ☕ 🍕 🍔 🍺 🌈 ☀️ 🌙 ⚡ ❄️ 🐶 🐱 🦊 🐸',
};

export function EmojiPicker({ onPick, onClose, up }: { onPick: (emoji: string) => void; onClose: () => void; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onDown));
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div className={`emoji-picker ${up ? 'up' : ''}`} ref={ref}>
      <input placeholder="Filtrar grupo…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {Object.entries(GROUPS).filter(([name]) => name.toLowerCase().includes(filter.toLowerCase())).map(([name, list]) => (
        <div key={name}>
          <small className="muted">{name}</small>
          <div className="emoji-grid">
            {list.split(' ').map((e) => <button key={e} onClick={() => onPick(e)}>{e}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}
