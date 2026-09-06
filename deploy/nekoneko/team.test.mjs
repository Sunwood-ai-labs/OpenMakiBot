import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { run, inside } from './team.mjs';

test('containment rejects sibling-prefix and traversal paths', () => {
  assert.equal(inside('/tmp/guide', '/tmp/guide/a'), true);
  assert.equal(inside('/tmp/guide', '/tmp/guide-other/a'), false);
  assert.equal(inside('/tmp/guide', '/tmp/guide/../other'), false);
});

test('dedicated marker and loopback URL are required', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nekoneko-team-test-'));
  try {
    await assert.rejects(run('status', { root }), /marker/);
    await fs.writeFile(path.join(root, '.nekoneko-guide.json'), '{"version":1}');
    await assert.rejects(run('status', { root, url: 'http://example.org' }), /loopback/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('stop and status accept an incomplete team and repeated stops are harmless', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nekoneko-team-test-'));
  let stops = 0;
  let container = 'running';
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/bots?messages=0') return res.end('{"bots":[],"groups":[]}');
    if (req.url.endsWith('/stop')) { stops++; container = 'stopped'; return res.end('{}'); }
    res.end(JSON.stringify({ container, managed: true, workspace_path: root }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fs.writeFile(path.join(root, '.nekoneko-guide.json'), '{"version":1}');
    await run('stop-desktops', { root, url });
    assert.equal(stops, 0);
    assert.equal((await run('status', { root, url })).pendingCards.length, 0);
    await fs.writeFile(path.join(root, 'nekoneko-team.json'), JSON.stringify({ bots: { sora: { id: 'sora' } } }));
    await run('stop-desktops', { root, url });
    await run('stop-desktops', { root, url });
    assert.equal(stops, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});

test('export copies only HTML/PNG, records hashes, and rejects escaping workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nekoneko-team-test-'));
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"bots":[],"groups":[]}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fs.writeFile(path.join(root, '.nekoneko-guide.json'), '{"version":1}');
    const manifest = { bots: {} };
    for (const role of ['sora', 'kinako']) {
      const workspace = path.join(root, role); manifest.bots[role] = { workspace };
      await fs.mkdir(path.join(workspace, 'nekoneko-demo'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'nekoneko-demo', 'index.html'), '<p>demo</p>');
      await fs.writeFile(path.join(workspace, 'nekoneko-demo', 'secret.json'), 'must not export');
    }
    await fs.writeFile(path.join(root, 'nekoneko-team.json'), JSON.stringify(manifest));
    const result = await run('export', { root, url });
    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].sha256.length, 64);
    assert.equal(result.files[0].sha256, result.files[1].sha256);
    await assert.rejects(fs.stat(path.join(root, 'nekoneko-export', 'sora', 'secret.json')), /ENOENT/);
    manifest.bots.sora.workspace = path.join(root, '..', 'outside');
    await fs.writeFile(path.join(root, 'nekoneko-team.json'), JSON.stringify(manifest));
    await assert.rejects(run('export', { root, url }), /escapes/);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
