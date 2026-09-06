import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const home = resolve(process.env.HOME || '');
const data = resolve(process.env.OMB_DATA_DIR || join(home, '.openmausbot'));
if (!existsSync(join(home, '.nekoneko-guide.json')) || JSON.parse(readFileSync(join(home, '.nekoneko-guide.json'), 'utf8')).version !== 1) {
  throw new Error('Refusing a data root without the guide marker. Run the dedicated setup first.');
}
const cfgDir = join(home, '.claude-zai');
const filename = join(data, 'config.json');
if (process.argv[2] === 'check') {
  const result = spawnSync('claude', ['-p', '--model', 'glm-5.3', '--output-format', 'text', '--tools', '', '--no-session-persistence', 'Reply with NEKONEKO_GLM_OK only.'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir }, encoding: 'utf8', timeout: 120000,
  });
  // Never echo raw provider errors or credentials into article/test logs.
  if (result.status !== 0 || !result.stdout?.includes('NEKONEKO_GLM_OK')) {
    console.error('GLM check failed. Confirm your Coding Plan key, network, and model access; then rerun configure.');
    process.exit(1);
  }
  console.log('NEKONEKO_GLM_OK');
} else {
  const response = await fetch(`http://127.0.0.1:${process.env.OMB_PORT || 29799}/api/bots?messages=0`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('The dedicated app must be ready before configure.');
  const fleet = await response.json();
  if (fleet.bots?.some(bot => bot.busy) || fleet.groups?.some(group => group.working)) throw new Error('Wait for the current task to finish before changing credentials.');
  let input = '';
  for await (const part of process.stdin) input += part;
  const { key } = JSON.parse(input);
  if (typeof key !== 'string' || key.trim().length < 8 || /[\r\n]/.test(key)) throw new Error('A Coding Plan key is required on stdin.');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  const config = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {};
  if (existsSync(filename)) copyFileSync(filename, filename + '.before-nekoneko');
  const environment = {
    ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
    ANTHROPIC_AUTH_TOKEN: key.trim(),
    ANTHROPIC_MODEL: 'glm-5.3',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.3',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  config.profile = { ...config.profile, name: 'Nekoneko guide' };
  config.instances = { ...config.instances, claudeZai: { driver: 'claudeAgent', displayName: 'Claude Code · GLM-5.3', environment: { CLAUDE_CONFIG_DIR: cfgDir, ...environment } } };
  config.localVm = { ...config.localVm, mode: 'per-bot', maxInstances: 2 };
  config.rooms = { ...config.rooms, turnTimeoutMinutes: 20 };
  writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ model: 'glm-5.3', availableModels: ['glm-5.3'], env: environment }, null, 2), { mode: 0o600 });
  writeFileSync(filename, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log('Configured GLM-5.3 in the dedicated data root. Restart the app before team setup.');
}
