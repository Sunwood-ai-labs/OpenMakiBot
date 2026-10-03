import { launchVerificationServer } from './control-omb.ts';
import { waitForExit } from '../server/testing/cleanup.ts';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Reuse the repository's owned fixture and cleanup boundary. Only an existing
// Codex credential is copied; histories, settings, and user app data are not.
const authSource = process.argv[2];
const cli = process.argv[3];
if (!authSource || !cli) throw new Error('Pass existing Codex auth.json and CLI paths');
const fixture = await launchVerificationServer();
await waitForExit(fixture.child, { signal: 'SIGTERM' });
const home = fixture.info.dataDir;
const codexHome = join(home, '.codex');
mkdirSync(codexHome, { recursive: true });
copyFileSync(authSource, join(codexHome, 'auth.json'));
writeFileSync(join(home, 'config.json'), JSON.stringify({ instances: { codex: { driver: 'codex', displayName: 'Live Codex verification', config: { cli } } } }));
const env = {};
for (const [key,value] of Object.entries(process.env)) if (['SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TZ'].includes(key.toUpperCase())) env[key] = value;
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home,'AppData','Roaming'), LOCALAPPDATA: join(home,'AppData','Local'), XDG_CONFIG_HOME: join(home,'.config'), XDG_CACHE_HOME: join(home,'.cache'), XDG_DATA_HOME: join(home,'.local','share'), TEMP: join(home,'tmp'), TMP: join(home,'tmp'), TMPDIR: join(home,'tmp'), HERMES_HOME: join(home,'.hermes'), CODEX_HOME: codexHome, OMB_DATA_DIR: home, OMB_PORT: new URL(fixture.info.url).port, OMB_WEBHOOK_PORT: String(Number(new URL(fixture.info.url).port)+1), PATH: dirname(process.execPath) });
const log = openSync(fixture.info.logPath, 'a');
const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {cwd:resolve('.'), env, stdio:['ignore',log,log], windowsHide:true});
closeSync(log);
let closing = false;
async function close() { if(closing)return; closing=true; await waitForExit(child,{signal:'SIGTERM'}); await fixture.close(); console.log(JSON.stringify({cleaned:true})); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
createInterface({input:process.stdin}).on('line',line=>{if(line==='stop')void close();});
console.log(JSON.stringify({...fixture.info,pid:child.pid,model:'live Codex',stop:'write stop to stdin'}));
