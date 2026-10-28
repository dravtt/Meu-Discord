import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import { useClickOutside } from './ContextMenu';
import { applyVoiceSettings } from '../lib/voice';
import { saveVoiceSettings, useVoiceSettings } from '../lib/voiceSettings';

/** Small arrow beside the mic / headphone button that lists the connected devices and lets the user pick one. */
export function DevicePicker({ kind }: { kind: 'input' | 'output' }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useClickOutside(ref, open, close);
  const current = useVoiceSettings((s) => (kind === 'input' ? s.inputDeviceId : s.outputDeviceId));
  const wanted = kind === 'input' ? 'audioinput' : 'audiooutput';

  useEffect(() => {
    if (!open) return;
    const load = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, [open]);

  const list = devices.filter((d) => d.kind === wanted && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const pick = (id: string) => { saveVoiceSettings(kind === 'input' ? { inputDeviceId: id } : { outputDeviceId: id }); void applyVoiceSettings(); close(); };
  const fallback = kind === 'input' ? 'Microfone' : 'Alto-falante';
  const row = (id: string, label: string) => (
    <button key={id} className={current === id ? 'active' : ''} onClick={() => pick(id)}>
      <span className="ellipsis">{label}</span>{current === id && <Check size={14} />}
    </button>
  );

  return (
    <span ref={ref} className="device-picker">
      <button className="device-arrow" title={kind === 'input' ? 'Escolher microfone' : 'Escolher saída de áudio'} onClick={() => setOpen(!open)}><ChevronUp size={12} /></button>
      {open && (
        <div className="device-menu">
          <h4>{kind === 'input' ? 'Dispositivo de entrada' : 'Dispositivo de saída'}</h4>
          {row('default', 'Padrão do sistema')}
          {list.map((d, i) => row(d.deviceId, d.label || `${fallback} ${i + 1}`))}
          {list.length === 0 && <small className="muted">Nenhum dispositivo encontrado. Permita o microfone no navegador.</small>}
        </div>
      )}
    </span>
  );
}
