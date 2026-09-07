import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfigPaths } from './config-paths.mjs';
import { guideSettings } from './settings.mjs';

test('configuration rejects external data despite a valid HOME marker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nekoneko-config-test-'));
  try {
    await fs.writeFile(path.join(root, '.nekoneko-guide.json'), '{"version":1}');
    assert.throws(() => validateConfigPaths(root, `${root}-other`), /inside/);
    assert.throws(() => validateConfigPaths(root, root), /inside/);
    assert.equal(validateConfigPaths(root).data, path.join(root, '.openmausbot'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('nondefault model, endpoint, port and timeout reach saved provider settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nekoneko-config-test-'));
  const server = http.createServer((req, res) => { assert.equal(req.url, '/api/bots?messages=0'); res.setHeader('content-type','application/json'); res.end('{"bots":[],"groups":[]}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fs.writeFile(path.join(root, '.nekoneko-guide.json'), '{"version":1}');
    const env = { ...process.env, HOME: root, OMB_DATA_DIR: path.join(root,'custom-data'), OMB_PORT: String(server.address().port), OMB_GLM_MODEL: 'glm-test-custom', OMB_ANTHROPIC_BASE_URL: 'https://example.test/custom/anthropic', OMB_TURN_TIMEOUT_MINUTES: '37' };
    assert.equal(guideSettings(env).port, server.address().port);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./configure.mjs', import.meta.url))], { env, stdio: ['pipe','pipe','pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end(JSON.stringify({key:'TEST_ONLY_NOT_A_REAL_KEY'}));
    const code = await new Promise(resolve => child.on('close', resolve));
    assert.equal(code,0,stderr);
    const config = JSON.parse(await fs.readFile(path.join(root,'custom-data','config.json'),'utf8'));
    assert.equal(config.instances.claudeZai.environment.ANTHROPIC_MODEL,'glm-test-custom');
    assert.equal(config.instances.claudeZai.environment.ANTHROPIC_BASE_URL,'https://example.test/custom/anthropic');
    assert.equal(config.rooms.turnTimeoutMinutes,37);
    const settings = JSON.parse(await fs.readFile(path.join(root,'.claude-zai','settings.json'),'utf8'));
    assert.deepEqual(settings.availableModels,['glm-test-custom']);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
