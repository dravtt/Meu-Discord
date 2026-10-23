import { useEffect, useState } from 'react';
import { AppWindow, Monitor, MonitorUp, Volume2 } from 'lucide-react';
import { startScreen, stopScreen, useCall, type ScreenQuality } from '../lib/voice';
import { savePrefs, usePrefs } from '../lib/prefs';
import { closeModal, Dialog, openModal } from './Modal';

interface Source { id: string; name: string; kind: 'screen' | 'window'; thumbnail: string; icon?: string }

/** Only the desktop app can list screens itself; in a browser the browser shows its own picker. */
const native = (window as any).nexoNative as undefined | {
  getScreenSources?: () => Promise<Source[]>;
  pickScreenSource?: (id: string, audio: boolean) => Promise<boolean>;
};

/** Screen share button: stops sharing, or opens the share dialog. */
export function openScreenShare() {
  if (useCall.getState().screen) void stopScreen();
  else openModal(<ScreenShareModal />);
}

const QUALITIES: [ScreenQuality, string, string][] = [['720', '720p', 'Leve'], ['1080', '1080p', 'Recomendado'], ['source', 'Original', 'Máxima nitidez']];
const FPS: [15 | 30 | 60, string][] = [[15, '15 FPS'], [30, '30 FPS'], [60, '60 FPS']];

function ScreenShareModal() {
  const { screenQuality, screenFps, screenAudio } = usePrefs();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [picked, setPicked] = useState<string | null>(null);
  const canList = !!native?.getScreenSources;

  useEffect(() => {
    if (!canList) return;
    const load = () => native!.getScreenSources!().then((list) => {
      setSources(list);
      setPicked((p) => p ?? list.find((s) => s.kind === 'screen')?.id ?? null);
    }).catch(() => setSources([]));
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [canList]);

  async function share() {
    closeModal();
    if (canList && picked) await native!.pickScreenSource!(picked, screenAudio);
    await startScreen({ quality: screenQuality, fps: screenFps, audio: screenAudio });
  }

  const shown = sources?.filter((s) => s.kind === tab) ?? [];

  return (
    <Dialog title="Transmitir sua tela" wide footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn primary go-live" disabled={canList && !picked} onClick={share}><MonitorUp size={18} /> Transmitir</button>
    </>}>
      {canList ? (
        <>
          <div className="share-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'screen'} className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><Monitor size={16} /> Telas</button>
            <button role="tab" aria-selected={tab === 'window'} className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}><AppWindow size={16} /> Janelas</button>
          </div>
          <div className="share-sources">
            {sources === null && <p className="muted">Procurando telas…</p>}
            {sources !== null && shown.length === 0 && <p className="muted">Nada para mostrar aqui.</p>}
            {shown.map((s) => (
              <button key={s.id} className={`share-source ${picked === s.id ? 'active' : ''}`} onClick={() => setPicked(s.id)} onDoubleClick={() => { setPicked(s.id); void share(); }}>
                <img src={s.thumbnail} alt="" />
                <span>{s.icon && <img src={s.icon} alt="" className="share-icon" />}{s.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="share-hint">
          <MonitorUp size={28} />
          <p>Escolha a qualidade abaixo. Depois de clicar em <strong>Transmitir</strong>, o navegador vai perguntar qual tela, janela ou guia você quer mostrar.</p>
        </div>
      )}

      <div className="share-options">
        <div>
          <span className="field-label">Resolução</span>
          <div className="segmented">
            {QUALITIES.map(([id, label, hint]) => (
              <button key={id} className={screenQuality === id ? 'active' : ''} onClick={() => savePrefs({ screenQuality: id })} title={hint}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="field-label">Taxa de quadros</span>
          <div className="segmented">
            {FPS.map(([id, label]) => (
              <button key={id} className={screenFps === id ? 'active' : ''} onClick={() => savePrefs({ screenFps: id })}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="check share-audio"><input type="checkbox" checked={screenAudio} onChange={(e) => savePrefs({ screenAudio: e.target.checked })} /> <Volume2 size={16} /> Transmitir o som do computador</label>
      <p className="muted small">{screenFps === 60 ? '60 FPS é ótimo para jogos e vídeos, mas usa mais internet.' : 'Para jogos e vídeos, escolha 60 FPS. Para textos e código, 15 ou 30 FPS deixam tudo mais nítido.'}</p>
    </Dialog>
  );
}
