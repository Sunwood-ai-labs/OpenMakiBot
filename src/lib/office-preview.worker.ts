// Parsing is isolated from the UI and terminated when its dialog closes.
import { parseOfficePreview } from './parse-office-preview';

self.onmessage = async (event: MessageEvent<{ data: Uint8Array; kind: 'presentation' | 'spreadsheet' }>) => {
  try {
    self.postMessage({ result: await parseOfficePreview(event.data.data, event.data.kind) });
  } catch {
    self.postMessage({ error: true });
  }
};
