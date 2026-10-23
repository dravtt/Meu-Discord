import { useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { useStore, set } from '../../lib/store';
import { uploadImage } from '../../lib/upload';
import { DEFAULT_NAME_STYLE, NAME_EFFECTS, NAME_FONTS, StyledName } from '../../lib/nameStyle';
import type { NameStyle, User, Widget } from '../../lib/types';
import { WidgetEditor } from './WidgetEditor';
import { Mural } from '../Mural';
import { ProfileView } from '../ProfileCard';

const SWATCHES = ['#14b8a6', '#22c55e', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#ffffff', '#64748b', '#0b0b0f'];

interface Draft {
  displayName: string; pronouns: string; customStatus: string; bio: string;
  avatarUrl: string | null; bannerUrl: string | null; profileColors: string[]; nameStyle: NameStyle; widgets: Widget[];
}

const draftOf = (u: User): Draft => ({
  displayName: u.displayName, pronouns: u.pronouns ?? '', customStatus: u.customStatus, bio: u.bio,
  avatarUrl: u.avatarUrl, bannerUrl: u.bannerUrl ?? null, profileColors: u.profileColors ?? [], nameStyle: u.nameStyle ?? DEFAULT_NAME_STYLE, widgets: u.widgets ?? [],
});

/** Settings > Perfil: everything about how you look to others, with a live preview of your card. */
export function ProfileEditor() {
  const me = useStore((s) => s.me)!;
  const status = useStore((s) => s.presence[me.id]?.status ?? me.status);
  const [draft, setDraft] = useState<Draft>(() => draftOf(me));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const edit = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setMsg(null); };
  const editName = (patch: Partial<NameStyle>) => setDraft((d) => ({ ...d, nameStyle: { ...d.nameStyle, ...patch } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(me));

  async function upload(field: 'avatarUrl' | 'bannerUrl', file: File | undefined) {
    if (!file) return;
    setBusy(field);
    try { edit({ [field]: await uploadImage(file) }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  async function save() {
    setBusy('save');
    try {
      // Only what changed, so an old value never blocks saving the rest.
      const before = draftOf(me) as unknown as Record<string, unknown>;
      const widgets = draft.widgets;
      const body = Object.fromEntries(Object.entries({ ...draft, widgets, displayName: draft.displayName.trim() || me.displayName })
        .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
      const updated = await api<User>('/users/@me', { method: 'PATCH', body });
      set((s) => ({ me: updated, presence: { ...s.presence, [updated.id]: { status: updated.status, customStatus: updated.customStatus } } }));
      setDraft(draftOf(updated));
      setMsg({ ok: true, text: 'Perfil salvo!' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  const effect = NAME_EFFECTS.find((e) => e.id === draft.nameStyle.effect) ?? NAME_EFFECTS[0];
  const nameColors = draft.nameStyle.colors;
  const twoColors = draft.profileColors.length === 2;
  const preview: User = { ...me, ...draft, displayName: draft.displayName || me.displayName };

  /** Picking an effect fills in sensible colors, so the change shows right away. */
  function pickEffect(id: string) {
    const e = NAME_EFFECTS.find((x) => x.id === id)!;
    const base = nameColors[0] ?? draft.profileColors[0] ?? '#14b8a6';
    const colors = e.colors.length === 1 ? [base] : [base, nameColors[1] ?? (id === 'outline' ? '#ffffff' : id === 'neon' ? base : '#ec4899')];
    editName({ effect: id, colors: id === 'solid' && !nameColors.length ? [] : colors });
  }

  return (
    <section>
      <h2>Perfil</h2>
      <div className="profile-editor">
        <div>
          <div className="pe-block">
            <label>Nome de exibição<input value={draft.displayName} maxLength={32} onChange={(e) => edit({ displayName: e.target.value })} /></label>
            <label>Pronomes<input value={draft.pronouns} maxLength={40} placeholder="ex.: ele/dele" onChange={(e) => edit({ pronouns: e.target.value })} /></label>
            <label>Status personalizado<input value={draft.customStatus} maxLength={128} placeholder="O que você está fazendo?" onChange={(e) => edit({ customStatus: e.target.value })} /></label>
            <label>Sobre mim<textarea value={draft.bio} maxLength={190} rows={3} onChange={(e) => edit({ bio: e.target.value })} /></label>
          </div>

          <div className="pe-block">
            <h3>Avatar e banner</h3>
            <p className="muted">PNG, JPG, GIF ou WEBP de até 8 MB. O banner fica melhor em 600 × 240.</p>
            <div className="pe-images">
              <span className="btn small pe-file"><ImagePlus size={14} /> {busy === 'avatarUrl' ? 'Enviando…' : 'Trocar avatar'}
                <input type="file" accept="image/*" aria-label="Trocar avatar" onChange={(e) => void upload('avatarUrl', e.target.files?.[0])} /></span>
              {draft.avatarUrl && <button className="btn small ghost" onClick={() => edit({ avatarUrl: null })}>Remover avatar</button>}
              <span className="btn small pe-file"><ImagePlus size={14} /> {busy === 'bannerUrl' ? 'Enviando…' : 'Trocar banner'}
                <input type="file" accept="image/*" aria-label="Trocar banner" onChange={(e) => void upload('bannerUrl', e.target.files?.[0])} /></span>
              {draft.bannerUrl && <button className="btn small ghost" onClick={() => edit({ bannerUrl: null })}>Remover banner</button>}
            </div>
          </div>

          <div className="pe-block">
            <h3>Cores do perfil</h3>
            <p className="muted">Uma cor só, ou primária e secundária para um degradê.</p>
            <div className="pe-row" style={{ marginBottom: 10 }}>
              <div className="segmented-sm" role="group" aria-label="Cores do perfil">
                <button className={draft.profileColors.length === 0 ? 'active' : ''} onClick={() => edit({ profileColors: [] })}>Padrão</button>
                <button className={draft.profileColors.length === 1 ? 'active' : ''} onClick={() => edit({ profileColors: [draft.profileColors[0] ?? '#14b8a6'] })}>Uma cor</button>
                <button className={twoColors ? 'active' : ''} onClick={() => edit({ profileColors: [draft.profileColors[0] ?? '#14b8a6', draft.profileColors[1] ?? '#6366f1'] })}>Duas cores</button>
              </div>
            </div>
            {draft.profileColors.length > 0 && (
              <div className="pe-row">
                <ColorField label="Primária" value={draft.profileColors[0]} onChange={(c) => edit({ profileColors: [c, ...draft.profileColors.slice(1)] })} />
                {twoColors && <ColorField label="Secundária" value={draft.profileColors[1]} onChange={(c) => edit({ profileColors: [draft.profileColors[0], c] })} />}
              </div>
            )}
          </div>

          <div className="pe-block">
            <h3>Estilo do nome</h3>
            <p className="muted">Aparece no chat, na lista de membros e no seu perfil.</p>
            <div className="font-grid" role="group" aria-label="Fonte do nome">
              {NAME_FONTS.map((f) => (
                <button key={f.id} className={draft.nameStyle.font === f.id ? 'active' : ''} onClick={() => editName({ font: f.id })} aria-label={`Fonte ${f.label}`}>
                  <StyledName user={{ nameStyle: { ...draft.nameStyle, font: f.id } }} className="sample">{preview.displayName}</StyledName>
                  <small>{f.label}</small>
                </button>
              ))}
            </div>
            <div className="pe-row" style={{ marginBottom: 10 }}>
              <div className="segmented-sm" role="group" aria-label="Efeito do nome">
                {NAME_EFFECTS.map((e) => <button key={e.id} className={draft.nameStyle.effect === e.id ? 'active' : ''} onClick={() => pickEffect(e.id)}>{e.label}</button>)}
              </div>
            </div>
            <div className="pe-row">
              {effect.colors.map((label, i) => (
                <ColorField key={label} label={label} value={nameColors[i] ?? (i === 0 ? '#f0f1f3' : '#ffffff')}
                  onChange={(c) => { const next = [...nameColors]; while (next.length < i) next.push('#ffffff'); next[i] = c; editName({ colors: next.slice(0, effect.colors.length) }); }} />
              ))}
              {effect.id === 'solid' && nameColors.length > 0 && <button className="btn small ghost" onClick={() => editName({ colors: [] })}><RotateCcw size={13} /> Cor padrão</button>}
            </div>
          </div>

          <div className="pe-block">
            <h3>Mural</h3>
            <p className="muted">Widgets que aparecem no seu perfil completo: seu jogo favorito, os jogos que você curte ou um texto.</p>
            <WidgetEditor widgets={draft.widgets} onChange={(widgets) => edit({ widgets })} onError={(text) => setMsg({ ok: false, text })} />
          </div>
        </div>

        <div className="preview">
          <h4>Prévia</h4>
          <ProfileView user={preview} name={preview.displayName} status={status} customStatus={draft.customStatus}>
            {draft.bio && <div className="pc-section"><h4>Sobre mim</h4><p className="pc-bio">{draft.bio}</p></div>}
          </ProfileView>
          {draft.widgets.length > 0 && <><h4 style={{ marginTop: 16 }}>Mural</h4><Mural widgets={draft.widgets} /></>}
        </div>
      </div>

      {(dirty || msg) && (
        <div className="pe-save-bar">
          <span className={msg ? (msg.ok ? 'ok' : 'error') : ''}>{msg ? msg.text : 'Você tem alterações não salvas.'}</span>
          {dirty && <button className="btn ghost" onClick={() => { setDraft(draftOf(me)); setMsg(null); }}>Desfazer</button>}
          {dirty && <button className="btn primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Salvando…' : 'Salvar alterações'}</button>}
        </div>
      )}
    </section>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="pe-color">
      <label className="color-field">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        {label} <code>{value.toUpperCase()}</code>
      </label>
      <div className="swatches" style={{ marginTop: 6 }}>
        {SWATCHES.map((c) => <button key={c} title={c} aria-label={`${label}: ${c}`} className={value.toLowerCase() === c ? 'active' : ''} style={{ background: c }} onClick={() => onChange(c)} />)}
      </div>
    </div>
  );
}
