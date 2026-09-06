import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const roles = [
  ['pm', 'むぎ部長｜PM', '目的と完了条件を整理して制作と検証へ割り振り、証拠を集約する。GUI操作は担当者へ渡す。'],
  ['sora', 'そら工房長｜制作A', '単一HTMLを制作し、自分に割り当てられたcomputerツールでFirefoxを操作して確認する。'],
  ['kinako', 'きなこ探偵｜検証B', '制作担当のHTMLを自分の作業領域へコピーし、自分のcomputerツールでFirefoxを操作して検証する。'],
];

export function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function rejectSymlinks(root, target) {
  if (!inside(root, target)) throw new Error('Path escapes dedicated root.');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed in export paths.');
  }
}

export async function run(command, options = {}) {
  const root = path.resolve(options.root || process.env.HOME || '');
  const marker = path.join(root, '.nekoneko-guide.json');
  const markerStat = await fs.lstat(marker).catch(() => null);
  if (!markerStat?.isFile() || markerStat.isSymbolicLink()) throw new Error('Dedicated guide environment marker is required.');
  if ((JSON.parse(await fs.readFile(marker, 'utf8'))).version !== 1) throw new Error('Unsupported guide environment marker.');
  const url = new URL(options.url || `http://127.0.0.1:${process.env.OMB_PORT || 8799}`);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('API URL must be a loopback HTTP origin.');
  const api = async (endpoint, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(new URL(endpoint, url), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(900_000) });
    if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}. Check the app for details.`);
    return response.json();
  };
  const manifestPath = path.join(root, 'nekoneko-team.json');
  const readManifest = async () => JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const save = async value => { await fs.writeFile(manifestPath, JSON.stringify(value, null, 2), { mode: 0o600 }); };
  const fleet = () => api('/api/bots?messages=0');
  const requireIdle = state => { if (state.bots.some(bot => bot.busy) || state.groups?.some(group => group.working)) throw new Error('A task is active. Wait for it to settle before this command.'); };
  const waitReady = async id => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const status = await api(`/api/bots/${id}/local-computer`);
      if (status.ready) return status;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Desktop readiness timed out. Use status and inspect the app.');
  };
  if (command === 'team') {
    const state = await fleet(); requireIdle(state);
    const manifest = await readManifest().catch(error => { if (error.code !== 'ENOENT') throw error; return { version: 1, bots: {} }; });
    await api('/api/config', { localVm: { mode: 'per-bot', maxInstances: 2 }, rooms: { turnTimeoutMinutes: 20 } }, 'PATCH');
    for (const [role, name, soul] of roles) {
      let bot = state.bots.find(item => item.id === manifest.bots[role]?.id);
      if (!bot && state.bots.some(item => item.name === name)) throw new Error(`Unrecorded bot named ${name} exists. Inspect this dedicated environment before retrying.`);
      if (!bot) {
        bot = (await api('/api/bots', { name, title: role === 'pm' ? 'PM' : role === 'sora' ? '制作' : '検証', section: 'ネコネコインダストリー', modelSelection: { instanceId: 'claudeZai', model: 'glm-5.3' }, requireAvailableModel: true })).bot;
        manifest.bots[role] = { id: bot.id, name }; await save(manifest);
      }
      await api(`/api/bots/${bot.id}`, { computer: role === 'pm' ? 'off' : 'vm', autoReview: 'enforce', modelSelection: { instanceId: 'claudeZai', model: 'glm-5.3' } }, 'PATCH');
      await api(`/api/bots/${bot.id}/profile`, { soul: `${soul} 日本語で簡潔に報告する。実際の保存先・操作結果・スクリーンショット・未確認事項を示す。` }, 'PATCH');
    }
    const image = await api('/api/local-computer');
    if (!image.image) await api('/api/local-computer/pull', {});
    for (const role of ['sora', 'kinako']) {
      const bot = manifest.bots[role];
      const before = await api(`/api/bots/${bot.id}/local-computer`);
      if (before.container === 'stopped') {
        if (!before.managed || !inside(root, before.workspace_path)) throw new Error('Stopped desktop is not a managed desktop in this dedicated environment.');
        // The public per-bot API exposes run rather than start. Recreate only
        // this recorded, managed container; its workspace bind mount persists.
        await api(`/api/bots/${bot.id}/local-computer/remove`, {});
      }
      if (!before.ready && before.container !== 'running') await api(`/api/bots/${bot.id}/local-computer/run`, {});
      const status = await waitReady(bot.id);
      if (!inside(root, status.workspace_path)) throw new Error('Desktop workspace is outside the dedicated root.');
      Object.assign(bot, { container: status.container_name, workspace: status.workspace_path, guestWorkspace: status.workspace_guest_path });
      await save(manifest);
    }
    if (manifest.group && !state.groups?.some(group => group.id === manifest.group.id)) {
      delete manifest.group;
      await save(manifest);
    }
    if (!manifest.group) {
      const group = (await api('/api/groups', { name: 'ネコネコインダストリー｜制作・検証室', section: 'ネコネコインダストリー', memberIds: roles.map(([role]) => manifest.bots[role].id), setup: { bulletin: 'PMが制作と検証を割り振る。制作と検証は自分のGUIを使い、HTMLはAからBへコピーして渡す。実行結果と未確認事項を報告する。', defaultResponder: { kind: 'member', botId: manifest.bots.pm.id } } })).group;
      manifest.group = { id: group.id, threadId: group.threadId }; await save(manifest);
    }
    return manifest;
  }
  const manifest = await readManifest().catch(error => {
    if (error.code === 'ENOENT' && ['stop-desktops', 'status'].includes(command)) return { version: 1, bots: {} };
    throw error;
  });
  if (command === 'start') {
    requireIdle(await fleet());
    for (const role of ['sora', 'kinako']) {
      const status = await api(`/api/bots/${manifest.bots[role].id}/local-computer`);
      if (!status.ready) throw new Error('Both desktops must be ready. Run team first.');
    }
    const text = `ネコネコインダストリーの会社紹介ページを単一HTMLで制作し、別GUIで検証してください。むぎがPM、そらが制作、きなこが検証です。外部通信や外部公開はせず、日本語の架空企業紹介、製品9点、社員猫3匹、カテゴリ切替、FAQを含めます。\nそらはHTMLを ${manifest.bots.sora.workspace}/nekoneko-demo/index.html に保存。きなこはそのHTMLだけを ${manifest.bots.kinako.workspace}/nekoneko-demo/index.html へコピーしチェックサムの一致を確認してください。必要なフォルダ作成とこの成果物のコピーを依頼します。\n各自のGUIゲストからは file:///home/cua/workspace/nekoneko-demo/index.html を開きます。HTML制作はClaude Codeのファイル操作、ブラウザ確認は必ず各Botのcomputerツールを使います。そらが制作と自GUI確認を終えた後、きなこが自GUIで表示・カテゴリ切替・FAQまでのスクロールを確認し、実スクリーンショットPNGを自workspaceのnekoneko-demo内へ保存。FAQ開閉は確認できた場合のみ成功と報告。PMは各担当の証拠と未確認事項をまとめて完了を判断してください。`;
    await api(`/api/groups/${manifest.group.id}/messages`, { threadId: manifest.group.threadId, sendId: randomUUID(), mode: 'goal', text });
    return { started: true, group: manifest.group };
  }
  if (command === 'status') {
    const state = await fleet();
    const group = state.groups?.find(item => item.id === manifest.group?.id);
    const history = group && manifest.group?.threadId ? await api(`/api/threads/${manifest.group.threadId}/messages?limit=100`) : { messages: [] };
    const messages = history.messages || [];
    const receipt = [...messages].reverse().find(message => message.goalRun)?.goalRun;
    const pending = messages.filter(message => message.card?.requestId && !message.card.answered && !message.card.dismissed).map(message => ({ messageId: message.id, kind: 'approval-or-question' }));
    return { group: { id: manifest.group?.id, working: group?.working, goalStatus: receipt?.status }, pendingCards: pending, bots: roles.map(([role]) => { const bot = state.bots.find(item => item.id === manifest.bots[role]?.id); return { role, id: bot?.id, busy: bot?.busy }; }), note: 'Pending cards are counted within the latest 100 group messages. Open the group in the app to review approvals and completion evidence.' };
  }
  if (command === 'stop-desktops') {
    requireIdle(await fleet());
    for (const role of ['sora', 'kinako']) {
      const bot = manifest.bots[role];
      if (!bot?.id) continue;
      const status = await api(`/api/bots/${bot.id}/local-computer`);
      if (status.container === 'missing' || status.container === 'stopped') continue;
      if (!status.managed || !inside(root, status.workspace_path)) throw new Error('Desktop is not managed within this dedicated environment.');
      await api(`/api/bots/${bot.id}/local-computer/stop`, {});
    }
    return { stopped: ['sora', 'kinako'], workspacesPreserved: true };
  }
  if (command === 'export') {
    requireIdle(await fleet());
    const destination = path.join(root, 'nekoneko-export');
    await fs.mkdir(destination, { recursive: true });
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('Export destination must not be a symlink.');
    const files = [];
    for (const role of ['sora', 'kinako']) {
      const source = path.join(manifest.bots[role].workspace, 'nekoneko-demo');
      if (!inside(root, source) || !inside(root, await fs.realpath(source))) throw new Error('Export source escapes dedicated root.');
      await rejectSymlinks(root, source);
      const target = path.join(destination, role); await fs.mkdir(target, { recursive: true });
      if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Export role directory must not be a symlink.');
      for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(html|png)$/i.test(entry.name)) continue;
        const original = path.join(source, entry.name); const output = path.join(target, entry.name);
        const existing = await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (existing?.isSymbolicLink()) throw new Error('Export output must not be a symlink.');
        const bytes = await fs.readFile(original); await fs.writeFile(output, bytes);
        files.push({ role, file: `${role}/${entry.name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
    const result = { version: 1, exportedAt: new Date().toISOString(), files };
    const outputManifest = path.join(destination, 'manifest.json');
    const existing = await fs.lstat(outputManifest).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing?.isSymbolicLink()) throw new Error('Export manifest must not be a symlink.');
    await fs.writeFile(outputManifest, JSON.stringify(result, null, 2));
    return result;
  }
  throw new Error('Commands: team, start, status, stop-desktops, export');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2); const options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--root', '--url'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --root PATH or --url LOOPBACK_URL'); options[args[i].slice(2)] = args[i + 1]; }
    console.log(JSON.stringify(await run(command, options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
