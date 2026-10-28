import { Check, Copy, Download, ExternalLink, X, ZoomIn } from 'lucide-react';
import { useState } from 'react';
import { closeModal, openModal } from './Modal';

/** Clipboard only takes PNG, so any image is redrawn on a canvas first. */
async function toPng(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

function ImageViewer({ url, filename }: { url: string; filename: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [status, setStatus] = useState<'' | 'copied' | 'failed'>('');

  const flash = (s: 'copied' | 'failed') => { setStatus(s); setTimeout(() => setStatus(''), 1800); };

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(url) })]);
      flash('copied');
    } catch { flash('failed'); }
  };

  const download = async () => {
    const a = document.createElement('a');
    a.download = filename;
    try {
      a.href = URL.createObjectURL(await (await fetch(url)).blob());
    } catch { a.href = url; }
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="image-viewer" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="image-viewer-bar">
        <button className="icon-btn" onClick={() => setZoomed((z) => !z)} title={zoomed ? 'Ajustar à tela' : 'Tamanho real'} aria-label="Zoom"><ZoomIn size={20} /></button>
        <button className="icon-btn" onClick={copy} title={status === 'failed' ? 'Não foi possível copiar' : 'Copiar imagem'} aria-label="Copiar imagem">
          {status === 'copied' ? <Check size={20} /> : <Copy size={20} />}
        </button>
        <button className="icon-btn" onClick={download} title="Baixar" aria-label="Baixar"><Download size={20} /></button>
        <a className="icon-btn" href={url} target="_blank" rel="noreferrer" title="Abrir no navegador" aria-label="Abrir no navegador"><ExternalLink size={20} /></a>
        <button className="icon-btn" onClick={closeModal} title="Fechar" aria-label="Fechar"><X size={20} /></button>
      </div>
      <div className={`image-viewer-stage ${zoomed ? 'zoomed' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
        <img src={url} alt={filename} onClick={() => setZoomed((z) => !z)} draggable={false} />
      </div>
      {status && <div className="image-viewer-toast">{status === 'copied' ? 'Imagem copiada!' : 'Seu navegador não deixou copiar a imagem.'}</div>}
    </div>
  );
}

export const openImageViewer = (url: string, filename: string) => openModal(<ImageViewer url={url} filename={filename} />);
