import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { guideSettings } from './settings.mjs';
import { validateConfigPaths } from './config-paths.mjs';

const settings = guideSettings();

const { home, data } = validateConfigPaths(process.env.HOME, process.env.OMB_DATA_DIR);
const cfgDir = join(home, '.claude-zai');
const filename = join(data, 'config.json');
if (process.argv[2] === 'check') {
  const result = spawnSync('claude', ['-p', '--model', settings.model, '--output-format', 'text', '--tools', '', '--no-session-persistence', 'Reply with NEKONEKO_GLM_OK only.'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir }, encoding: 'utf8', timeout: 120000,
  });
  // Never echo raw provider errors or credentials into article/test logs.
  if (result.status !== 0 || !result.stdout?.includes('NEKONEKO_GLM_OK')) {
    console.error('GLM check failed. Confirm your Coding Plan key, network, and model access; then rerun configure.');
    process.exit(1);
  }
  console.log('NEKONEKO_GLM_OK');
} else {
  const response = await fetch(`http://127.0.0.1:${settings.port}/api/bots?messages=0`, { signal: AbortSignal.timeout(15000) });
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
    ANTHROPIC_BASE_URL: settings.baseUrl,
    ANTHROPIC_AUTH_TOKEN: key.trim(),
    ANTHROPIC_MODEL: settings.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: settings.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: settings.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: settings.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  config.profile = { ...config.profile, name: 'Nekoneko guide' };
  config.instances = { ...config.instances, claudeZai: { driver: 'claudeAgent', displayName: `Claude Code · ${settings.model}`, environment: { CLAUDE_CONFIG_DIR: cfgDir, ...environment } } };
  config.localVm = { ...config.localVm, mode: 'per-bot', maxInstances: 2 };
  config.rooms = { ...config.rooms, turnTimeoutMinutes: settings.turnTimeout };
  writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ model: settings.model, availableModels: [settings.model], env: environment }, null, 2), { mode: 0o600 });
  writeFileSync(filename, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`Configured ${settings.model} in the dedicated data root. Restart the app before team setup.`);
}
