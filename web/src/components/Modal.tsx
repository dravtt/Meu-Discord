import { X } from 'lucide-react';
import { create } from 'zustand';
import { useEffect, type ReactNode } from 'react';

const useModal = create<{ content: ReactNode | null }>(() => ({ content: null }));

export const openModal = (content: ReactNode) => useModal.setState({ content });
export const closeModal = () => useModal.setState({ content: null });

export function ModalHost() {
  const content = useModal((s) => s.content);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!content) return null;
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>{content}</div>;
}

export function Dialog({ title, children, footer, wide }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-btn" onClick={closeModal} aria-label="Fechar"><X size={20} /></button></header>
      <div className="dialog-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  );
}

export function confirmDialog(title: string, text: string, action: string, onConfirm: () => Promise<void> | void) {
  openModal(
    <Dialog title={title} footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn danger" onClick={async () => { await onConfirm(); closeModal(); }}>{action}</button>
    </>}>
      <p>{text}</p>
    </Dialog>,
  );
}
