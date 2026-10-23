import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

const SHAPES = {
  avatar: { w: 280, h: 280, outW: 512, outH: 512, round: true, title: 'Ajustar avatar' },
  banner: { w: 460, h: 184, outW: 1200, outH: 480, round: false, title: 'Ajustar banner' },
};

/**
 * Lets you drag and zoom a picture inside the avatar circle (or banner frame) before it is uploaded.
 * Returns the cropped picture as a new file.
 */
export function ImageCropper({ file, shape, onDone, onCancel }: {
  file: File; shape: keyof typeof SHAPES; onDone: (f: File) => void; onCancel: () => void;
}) {
  const s = SHAPES[shape];
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const base = Math.max(s.w / i.naturalWidth, s.h / i.naturalHeight);
      setPos({ x: (s.w - i.naturalWidth * base) / 2, y: (s.h - i.naturalHeight * base) / 2 });
    };
    i.onerror = () => setError('Não consegui abrir essa imagem.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, s.w, s.h]);

  const base = img ? Math.max(s.w / img.naturalWidth, s.h / img.naturalHeight) : 1;
  const dw = img ? img.naturalWidth * base * zoom : 0;
  const dh = img ? img.naturalHeight * base * zoom : 0;
  // The picture always covers the whole frame.
  const clamp = (p: { x: number; y: number }, w = dw, h = dh) => ({ x: Math.min(0, Math.max(s.w - w, p.x)), y: Math.min(0, Math.max(s.h - h, p.y)) });

  function changeZoom(z: number) {
    if (!img) return;
    const next = Math.min(4, Math.max(1, z));
    // Zoom around the middle of the frame.
    const cx = (s.w / 2 - pos.x) / dw, cy = (s.h / 2 - pos.y) / dh;
    const nw = img.naturalWidth * base * next, nh = img.naturalHeight * base * next;
    setZoom(next);
    setPos(clamp({ x: s.w / 2 - cx * nw, y: s.h / 2 - cy * nh }, nw, nh));
  }

  const onDown = (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  };

  async function apply() {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = s.outW;
    canvas.height = s.outH;
    const k = s.outW / s.w;
    canvas.getContext('2d')!.drawImage(img, pos.x * k, pos.y * k, dw * k, dh * k);
    const type = shape === 'avatar' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    if (!blob) return setError('Não consegui recortar a imagem.');
    onDone(new File([blob], `${shape}.${type === 'image/png' ? 'png' : 'jpg'}`, { type }));
  }

  return (
    <div className="cropper-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog cropper" role="dialog" aria-label={s.title}>
        <header><h2>{s.title}</h2></header>
        <div className="dialog-body">
          <div className={`crop-frame ${s.round ? 'round' : ''}`} style={{ width: s.w, height: s.h }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
            onWheel={(e) => changeZoom(zoom - e.deltaY / 500)}>
            {img && <img src={img.src} alt="" draggable={false} style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
          </div>
          <p className="muted small" style={{ textAlign: 'center' }}>Arraste para posicionar e use a barra para dar zoom.</p>
          <div className="crop-zoom">
            <ZoomOut size={16} />
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} aria-label="Zoom" />
            <ZoomIn size={16} />
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <footer>
          <button className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={!img} onClick={() => void apply()}>Aplicar</button>
        </footer>
      </div>
    </div>
  );
}
