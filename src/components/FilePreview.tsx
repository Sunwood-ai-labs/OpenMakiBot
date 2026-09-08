import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, FileText, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { filePreviewKind, fileRequestUrl, previewDisplayName, previewMimeAllowed } from '@/lib/file-preview';
import { t } from '@/lib/i18n';
import { canonicalDownloadFilename, useLocalFileSave, type MessageAttachmentContext } from './AttachmentPreview';

const PdfPreview = lazy(() => import('./PdfPreview'));
const OfficePreview = lazy(() => import('./OfficePreview'));

export function PreviewableFile({ path, name, message, children, compact = false }: {
  path: string; name?: string; message: MessageAttachmentContext; children?: ReactNode; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = name || previewDisplayName(path);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={t('filePreview.open', { name: label })}
      className={compact ? 'inline-flex items-center gap-1 break-words text-left text-accent underline decoration-accent/40 hover:decoration-accent' : 'flex max-w-[320px] items-center gap-3 rounded-xl border border-hairline/50 bg-inset/70 px-3 py-2.5 text-left hover:bg-raised/70'}>
      {compact ? <Eye size={14} aria-hidden="true" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><FileText size={19} /></span>}
      {compact ? children || label : <span className="min-w-0"><span className="block truncate text-[12px] font-medium text-ink">{label}</span><span className="mt-0.5 block text-[10.5px] text-ink-secondary">{t('filePreview.hint')}</span></span>}
    </button>
    {open && <FilePreviewDialog key={`${message.threadId}:${message.messageId}:${path}`} path={path} name={label} message={message} onClose={() => setOpen(false)} />}
  </>;
}

function FilePreviewDialog({ path, name, message, onClose }: { path: string; name: string; message: MessageAttachmentContext; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<{ data: Uint8Array; url: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const save = useLocalFileSave(path, name, message);
  const kind = filePreviewKind(path)!;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    if (root) root.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, [tabindex="0"]') ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (root) root.inert = previousInert ?? false;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setFile(null);
    setError('');
    void (async () => {
      try {
        const response = await fetch(fileRequestUrl(message), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }), signal: controller.signal });
        if (!response.ok) throw new Error(t('filePreview.fetchFailed'));
        if (!previewMimeAllowed(kind, response.headers.get('content-type') || '')) throw new Error(t('filePreview.invalidFile'));
        const blob = await response.blob();
        if (blob.size > 25 * 1024 * 1024) throw new Error(t('filePreview.tooLarge'));
        const data = new Uint8Array(await blob.arrayBuffer());
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setFile({ data, url: objectUrl, name: canonicalDownloadFilename({ contentDisposition: response.headers.get('content-disposition'), fallback: name }) });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('filePreview.fetchFailed'));
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, name, message.threadId, message.messageId, attempt, kind]);

  return createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('filePreview.open', { name })} tabIndex={-1} className="flex h-full max-h-[1100px] w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-hairline bg-card text-ink shadow-2xl outline-none">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
        <FileText size={20} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{file?.name || name}</div><div className="text-[11px] text-ink-secondary">{t('filePreview.document')}</div></div>
        {file ? <a href={file.url} download={file.name} aria-label={t('filePreview.download')} title={t('filePreview.download')} className="rounded-lg p-2 hover:bg-raised"><Download size={18} /></a> : <button type="button" onClick={() => void save.save()} disabled={save.state === 'saving'} aria-label={t('filePreview.download')} className="rounded-lg p-2 hover:bg-raised"><Download size={18} /></button>}
        <button type="button" onClick={onClose} aria-label={t('filePreview.close')} className="rounded-lg p-2 hover:bg-raised"><X size={20} /></button>
      </header>
      {error ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center" role="alert"><FileText size={36} className="text-ink-secondary" /><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="flex items-center gap-2 rounded-lg border border-hairline px-4 py-2"><RotateCcw size={15} />{t('filePreview.retry')}</button></div> : file ? kind === 'video' ? <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-4"><video src={file.url} tabIndex={0} controls playsInline preload="metadata" aria-label={file.name} onError={() => setError(t('filePreview.videoFailed'))} className="max-h-full max-w-full" /></div> : <PreviewBoundary onError={setError}><Suspense fallback={<PreviewLoading />}>{kind === 'pdf' ? <PdfPreview data={file.data} onError={setError} /> : <OfficePreview data={file.data} kind={kind} onError={setError} />}</Suspense></PreviewBoundary> : <PreviewLoading />}
      {save.state === 'failed' && <p role="alert" className="p-3 text-sm text-danger">{save.reason}</p>}
    </div>
  </div>, document.body);
}

export function PreviewLoading() {
  return <div role="status" className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-ink-secondary"><LoaderCircle size={18} className="animate-spin" />{t('filePreview.loading')}</div>;
}

class PreviewBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(t('filePreview.invalidFile')); }
  render() { return this.state.failed ? null : this.props.children; }
}
