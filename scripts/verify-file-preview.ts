// Real web app and authenticated attachment routes on a disposable fake engine.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer, preview } from 'vite';
import { launchVerificationServer, runControlOmb } from './control-omb.ts';
import { previewPdf } from './testing/preview-pdf.ts';
import { previewPresentation, previewSpreadsheet } from './testing/preview-office.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = join(root, 'docs/verification/evidence/file-preview');
mkdirSync(evidence, { recursive: true });
const fixture = await launchVerificationServer(process.env, undefined, [
  'The project files are ready to review:\n\n[Project notes](<Project field notes.pdf>) · [Workbook](<Project overview.xlsx>) · [Slides](<Project review.pptx>) · [Video](<Project motion.mp4>)',
]);
let ui: Awaited<ReturnType<typeof createServer>> | undefined;
let builtUi: Awaited<ReturnType<typeof preview>> | undefined;
try {
  const created = await runControlOmb(['new-bot', '--name', 'Document review', '--url', fixture.info.url]) as { bot: { id: string } };
  const video = join(root, 'scripts/testing/file-preview/sample.mp4');
  const samples = [
    { name: 'Project field notes.pdf', mime: 'application/pdf', bytes: new Uint8Array(previewPdf()) },
    { name: 'Project overview.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: previewSpreadsheet() },
    { name: 'Project review.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: await previewPresentation() },
    ...(existsSync(video) ? [{ name: 'Project motion.mp4', mime: 'video/mp4', bytes: new Uint8Array(readFileSync(video)) }] : []),
  ];
  const uploaded: Array<{ path: string; name: string }> = [];
  const workspace = join(fixture.info.dataDir, 'workspaces', created.bot.id);
  mkdirSync(workspace, { recursive: true });
  for (const sample of samples) {
    writeFileSync(join(workspace, sample.name), sample.bytes);
    const response = await fetch(`${fixture.info.url}/api/files?name=${encodeURIComponent(sample.name)}`, { method: 'POST', headers: { 'content-type': sample.mime }, body: sample.bytes });
    if (!response.ok) {
      if (process.argv.includes('--baseline') && sample.mime === 'video/mp4') continue;
      throw new Error(`Fixture upload failed: ${response.status} ${await response.text()}`);
    }
    uploaded.push(await response.json() as { path: string; name: string });
  }
  // The composer separates transport tags with blank lines (Markdown blocks).
  const tags = uploaded.map((file) => `<attached-file path="${file.path}" name="${file.name}" />`).join('\n\n');
  const sent = await runControlOmb(['send', '--bot', created.bot.id, '--text', `Please review the project files.\n\n${tags}`, '--url', fixture.info.url]);
  const settled = await runControlOmb(['wait', '--bot', created.bot.id, '--timeout', '30', '--url', fixture.info.url]);
  const messages = await runControlOmb(['messages', '--bot', created.bot.id, '--url', fixture.info.url]);
  let previewUrl: string;
  if (process.argv.includes('--built')) {
    builtUi = await preview({ root, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fixture.info.url } } } });
    previewUrl = builtUi.resolvedUrls.local[0];
  } else {
    ui = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fixture.info.url } } } });
    await ui.listen();
    previewUrl = ui.resolvedUrls!.local[0];
  }
  const info = { ...fixture.info, previewUrl, botId: created.bot.id, uploaded, sent, settled, messages };
  writeFileSync(join(evidence, 'fixture.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  await new Promise<void>((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally {
  await ui?.close();
  await new Promise<void>((resolve, reject) => { if (!builtUi) resolve(); else builtUi.httpServer.close((error) => error ? reject(error) : resolve()); });
  await fixture.close();
}
