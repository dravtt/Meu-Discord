import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { ACTIONS, comboLabel, comboOf, recording, resetKeybinds, saveKeybind, useKeybinds } from '../../lib/keybinds';
import { keyLabel, useVoiceSettings } from '../../lib/voiceSettings';

/** Settings > Atalhos de teclado: pick a key (or a combination) for each action. */
export function KeybindsPanel() {
  const binds = useKeybinds();
  const ptt = useVoiceSettings((s) => (s.inputMode === 'ptt' ? s.pttKey : null));
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    recording.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { setEditing(null); return; }
      const combo = comboOf(e);
      if (!combo) return; // waiting for the key that goes with the modifiers
      saveKeybind(editing, combo);
      setEditing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { recording.active = false; window.removeEventListener('keydown', onKey, true); };
  }, [editing]);

  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <section>
      <h2>Atalhos de teclado</h2>
      <p className="muted">
        Clique em um atalho e aperte a tecla ou a combinação que quiser (por exemplo <kbd>F9</kbd> ou <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd>).
        Esc cancela. Uma tecla sozinha não dispara enquanto você digita no chat.
      </p>
      {ptt && <p className="muted small">A tecla de apertar para falar (<kbd>{keyLabel(ptt)}</kbd>) fica em Voz e vídeo.</p>}
      {groups.map((g) => (
        <div key={g} className="keybind-group">
          <h3>{g}</h3>
          {ACTIONS.filter((a) => a.group === g).map((a) => (
            <div key={a.id} className="keybind-row">
              <span>{a.label}</span>
              <button className={`btn key-capture ${editing === a.id ? 'capturing' : ''}`} onClick={() => setEditing(editing === a.id ? null : a.id)} aria-label={`Atalho: ${a.label}`}>
                {editing === a.id ? 'Aperte as teclas…' : binds[a.id] ? comboLabel(binds[a.id]) : 'Nenhum'}
              </button>
              <button className="icon-btn" title="Remover atalho" aria-label={`Remover atalho de ${a.label}`} disabled={!binds[a.id]} onClick={() => saveKeybind(a.id, '')}><X size={16} /></button>
            </div>
          ))}
        </div>
      ))}
      <button className="btn ghost" onClick={resetKeybinds}><RotateCcw size={14} /> Restaurar atalhos padrão</button>
    </section>
  );
}
