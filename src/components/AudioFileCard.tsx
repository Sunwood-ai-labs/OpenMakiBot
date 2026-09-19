import { useState } from 'react';
import { Download, LoaderCircle, Music, RotateCcw } from 'lucide-react';
import { t } from '@/lib/i18n';

/** An audio clip a bot attached: a name and the browser's own player. The bytes
 * load through the same message-scoped authorization as every other preview, and
 * playback only ever starts from the player's controls. */
export function AudioFileCard({ label, file, error, onRetry }: {
  label: string;
  file?: { url: string; name: string };
  error?: string;
  onRetry: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState('');
  const failed = !!error || (!!file && failedUrl === file.url);
  return <span className="my-1 inline-flex w-72 max-w-full flex-col gap-1.5 rounded-2xl border border-hairline/30 bg-inset/60 px-3 py-2.5 text-left align-top">
    <span className="flex items-center gap-2">
      <Music size={14} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={label}>{label}</span>
      {file && !failed && <a href={file.url} download={file.name} aria-label={t('filePreview.download')} title={t('filePreview.download')}
        className="shrink-0 rounded-lg p-1 text-ink-secondary hover:bg-raised hover:text-ink"><Download size={14} /></a>}
    </span>
    {failed ? <span role="alert" className="flex items-start gap-2 text-[11px] text-danger">
      <span className="min-w-0 flex-1">{error || t('filePreview.audioFailed')}</span>
      <button type="button" onClick={onRetry} aria-label={t('filePreview.retry')} title={t('filePreview.retry')} className="shrink-0 rounded p-1 hover:bg-raised"><RotateCcw size={13} /></button>
    </span>
      : file ? <audio src={file.url} controls preload="metadata" aria-label={t('filePreview.playAudio', { name: label })} onError={() => setFailedUrl(file.url)} className="h-9 w-full" />
        : <span role="status" className="flex items-center gap-2 text-[11px] text-ink-secondary"><LoaderCircle size={14} className="animate-spin" />{t('filePreview.loading')}</span>}
  </span>;
}
