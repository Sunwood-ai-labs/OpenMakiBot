import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { t } from "@/lib/i18n";

const REVEALABLE_PATH = /^(?:\/(?!\/)|[a-zA-Z]:[\\/])/;
function revealBridge(): NonNullable<Window["ogb"]>["revealInFolder"] {
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  return ogb?.remoteClient?.active ? undefined : ogb?.revealInFolder;
}

export function OutsideWorkspaceFile({ filePath }: { filePath: string }) {
  const [problem, setProblem] = useState("");
  const reveal = revealBridge();
  if (!reveal || !REVEALABLE_PATH.test(filePath)) {
    return (
      <code title={t("attach.outsideWorkspacePath")} className="select-all break-all text-ink">
        {filePath}
      </code>
    );
  }
  const show = async () => {
    setProblem("");
    try {
      const result = await reveal(filePath);
      if (result === "missing") setProblem(t("attach.revealMissing"));
      else if (result !== "shown") setProblem(t("attach.revealFailed"));
    } catch {
      setProblem(t("attach.revealFailed"));
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void show()}
        title={filePath}
        className="inline-flex items-center gap-1 text-accent underline decoration-accent/40 hover:decoration-accent"
      >
        <FolderOpen size={12} className="shrink-0" aria-hidden="true" />
        {t("attach.showInFolder")}
      </button>
      {problem && <span role="alert" className="text-danger">{problem}</span>}
    </>
  );
}
