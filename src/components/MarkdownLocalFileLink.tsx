import type { ReactNode } from "react";
import { Check, Download, LoaderCircle, RotateCcw } from "lucide-react";
import { attachmentBasename } from "@/lib/composer-attachments";
import { filePreviewKind } from "@/lib/file-preview";
import { MessageFolderFiles, saveFailureText, useLocalFileSave, type MessageAttachmentContext } from "./AttachmentPreview";
import { PreviewableFile } from "./FilePreview";
import { FilePreviewButton } from "./FilePreviewButton";
import { OutsideWorkspaceFile } from "./OutsideWorkspaceFile";

// Keep message-local files out of hrefs: modified clicks must still pass the
// main process' workspace containment check.
export function MarkdownLocalFileLink({ filePath, name, children, message }: {
  filePath: string;
  name?: string;
  children?: ReactNode;
  message?: MessageAttachmentContext;
}) {
  const save = useLocalFileSave(filePath, name, message);
  if (!message) {
    return <span title="Unavailable legacy file reference" className="break-words text-ink-secondary">{children}</span>;
  }
  const localPreview = Boolean(filePreviewKind(filePath) && !/\.(csv|tsv)$/i.test(filePath));
  const label = save.state === "saving"
    ? "Saving…"
    : save.state === "saved"
      ? "Saved"
      : save.state === "failed"
        ? "Retry"
        : null;

  return (
    <span dir="ltr" className="inline-flex flex-wrap items-center gap-x-1.5 [unicode-bidi:isolate]">
      {localPreview
        ? <PreviewableFile path={filePath} name={name} message={message} compact>{children}</PreviewableFile>
        : <FilePreviewButton path={filePath} name={name ?? attachmentBasename(filePath)} message={message} />}
      <button
        type="button"
        onClick={() => void save.save()}
        disabled={save.state === "saving"}
        aria-label={localPreview ? "Save a copy" : undefined}
        title="Save a copy"
        className="inline-flex items-center gap-1 break-words text-start text-accent underline decoration-accent/40 hover:decoration-accent disabled:cursor-wait"
      >
        {localPreview ? <span className="sr-only">Save a copy</span> : children}
        {save.state === "saving" ? (
          <LoaderCircle size={12} className="shrink-0 animate-spin" aria-hidden="true" />
        ) : save.state === "saved" ? (
          <Check size={12} className="shrink-0 text-success" aria-hidden="true" />
        ) : save.state === "failed" ? (
          !save.outsideWorkspace && <RotateCcw size={12} className="shrink-0" aria-hidden="true" />
        ) : (
          <Download size={12} className="shrink-0" aria-hidden="true" />
        )}
      </button>
      {label && (
        <span
          role={save.state === "failed" ? "alert" : "status"}
          title={save.state === "saved" ? save.savedTo : undefined}
          className={`text-[12px] ${save.state === "saved" ? "text-success" : save.state === "failed" ? "text-danger" : "text-ink-secondary"}`}
        >
          {save.state === "failed" ? saveFailureText(save) : label}
        </span>
      )}
      {save.state === "failed" && save.outsideWorkspace && (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[12px]">
          <OutsideWorkspaceFile filePath={filePath} />
        </span>
      )}
      {save.folder && <MessageFolderFiles folderPath={filePath} listing={save.folder} message={message} />}
    </span>
  );
}
