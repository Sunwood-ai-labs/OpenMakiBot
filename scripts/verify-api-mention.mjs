import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const url = process.argv[2];
const glm = process.argv.includes('--glm');
const live = glm || process.argv.includes('--live');
assert.match(url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const out = new URL(`../docs/verification/evidence/api-mention-20260913/${glm ? 'glm/' : live ? 'live/' : ''}`, import.meta.url);
mkdirSync(out, { recursive: true });
const records = [];
const save = () => writeFileSync(new URL('transport.json', out), JSON.stringify(records, null, 2));
async function api(path, body) {
  const response = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  records.push({ transport: 'HTTP', path, body, status: response.status, result }); save();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
const instances = await api('/api/instances');
assert.ok(JSON.stringify(instances).includes(glm ? 'CC GLM-5.3 isolated verification' : live ? 'Live Codex verification' : 'Verification fixture'), 'Only target the isolated verification fixture');
const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/mcp-server.ts'], { env: { ...process.env, OPENMAUSBOT_URL: url, OPENMAUSBOT_TOKEN: '' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let id = 0;
const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const result = JSON.parse(line);
  const entry = pending.get(result.id);
  if (entry) { clearTimeout(entry.timer); pending.delete(result.id); entry.resolve(result); }
});
child.stderr.on('data', data => { records.push({ transport: 'MCP stderr', text: String(data) }); save(); });
async function rpc(method, params) {
  const request = { jsonrpc: '2.0', id: ++id, method, params };
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(request.id); reject(new Error('MCP timeout')); }, 45000);
    pending.set(request.id, { resolve, timer }); child.stdin.write(JSON.stringify(request) + '\n');
  });
  records.push({ transport: 'MCP stdio', request, response }); save();
  assert.ok(!response.error, JSON.stringify(response));
  assert.ok(!response.result?.isError, JSON.stringify(response));
  return response.result;
}
async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  return result.structuredContent ?? JSON.parse(result.content.find(x => x.type === 'text').text);
}
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'api-mcp-evidence', version: '1.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('tools/list', {});
  const previous = process.argv.includes('--reuse') && existsSync(new URL('targets.json', out)) ? JSON.parse(readFileSync(new URL('targets.json', out))) : null;
  if (previous) assert.equal(previous.url, url);
  const description = live ? 'API・MCP検証用。日本語で短く答える。ツールは使わない。会議では直前のユーザーの問いだけに答える。' : 'Isolated scripted fixture; not a live model.';
  const a = previous?.a ?? (await api('/api/bots', { name: 'API検証Bot', description })).bot;
  const b = previous?.b ?? (await tool('create_bot', { name: 'MCP検証Bot', description })).bot;
  const room = previous?.room ?? (await tool('create_channel', { name: 'API・MCP会議実験', member_ids: [a.id, b.id] })).channel;
  room.threadId = room.activeTaskId;
  if (live) {
    const instanceId=glm?'claude':'codex';
    const model = glm?'glm-5.3':instances.instances.find(i=>i.instanceId===instanceId).models.default;
    for (const bot of [a,b]) {
      await tool('set_bot_model', { bot_id: bot.id, instance_id:instanceId, model, effort:'low' });
      bot.modelSelection = {instanceId,model,effort:'low'};
    }
  }
  writeFileSync(new URL('targets.json', out), JSON.stringify({ url, a, b, room }, null, 2));
  async function wait(type, target) {
    let result;
    for (let attempt=0; attempt<10; attempt++) {
      result = await tool('wait_for_conversation', { target_type: type, target_id: target.id, timeout_seconds: 30 });
      if(result.status !== 'timed-out') break;
    }
    assert.equal(result.status, 'settled', JSON.stringify(result));
  }
  await tool('update_channel', {channel_id:room.id, default_responder:{kind:'member',bot_id:b.id}});
  const requests=[
    {transport:'HTTP',text:'@API検証Bot 137+286はいくつですか？日本語で短く答えてください。'},
    {transport:'MCP stdio',text:'@API検証Bot さっきの答えを2倍するといくつ？日本語で短く答えてください。'}
  ];
  for(const request of requests){
    if(request.transport==='HTTP') await api(`/api/groups/${room.id}/messages`,{text:request.text,threadId:room.threadId});
    else await tool('send_channel_message',{channel_id:room.id,task_id:room.threadId,text:request.text});
    await wait('channel',room);
  }
  const group=await tool('get_channel_messages',{channel_id:room.id,limit:30});
  const replies=group.messages.filter(m=>m.role==='bot'&&m.kind==='text');
  assert.equal(replies.length,2);
  assert.ok(replies.every(m=>m.from?.botId===a.id));
  assert.ok(replies[0].text.includes('423'));
  assert.ok(replies[1].text.includes('846'));
  assert.equal(group.channel.defaultResponder.botId,b.id);
  writeFileSync(new URL('summary.json',out),JSON.stringify({passed:true,model:'CC GLM-5.3',requests,a,b,group},null,2));
  console.log(JSON.stringify({passed:true,room:room.id,replies:replies.map(m=>({text:m.text,from:m.from})),evidence:out.pathname}));
} finally { child.stdin.end(); }

