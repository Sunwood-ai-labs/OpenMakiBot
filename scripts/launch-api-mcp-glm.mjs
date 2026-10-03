import { launchVerificationServer } from './control-omb.ts';
import { waitForExit } from '../server/testing/cleanup.ts';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const cli = process.argv[2];
if (!cli || !existsSync(cli)) throw new Error('Pass the installed Claude Code executable');
const source = JSON.parse(execFileSync('wsl.exe', ['-d','podman-openmausbot','--','cat','/home/user/openmausbot/data/.openmausbot/config.json'], {encoding:'utf8',windowsHide:true}));
const saved = source.instances?.claudeZai?.environment;
if(!saved?.ANTHROPIC_AUTH_TOKEN || saved.ANTHROPIC_MODEL!=='glm-5.3') throw new Error('Expected existing claudeZai GLM-5.3 configuration');
const provider = {};
for(const key of ['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']) if(typeof saved[key]==='string')provider[key]=saved[key];
provider.CLAUDE_CODE_GIT_BASH_PATH='C:/Program Files/Git/bin/bash.exe';
const fixture=await launchVerificationServer();
await waitForExit(fixture.child,{signal:'SIGTERM'});
const home=fixture.info.dataDir;
const ccHome=join(home,'.claude-live');
mkdirSync(ccHome,{recursive:true});
provider.CLAUDE_CONFIG_DIR=ccHome;
writeFileSync(join(ccHome,'settings.json'),JSON.stringify({model:'glm-5.3'}));
writeFileSync(join(home,'config.json'),JSON.stringify({instances:{claude:{driver:'claudeAgent',displayName:'CC GLM-5.3 isolated verification',environment:provider,config:{cli}}}}));
const env={};
for(const [key,value]of Object.entries(process.env))if(['SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TZ'].includes(key.toUpperCase()))env[key]=value;
Object.assign(env,{HOME:home,USERPROFILE:home,APPDATA:join(home,'AppData','Roaming'),LOCALAPPDATA:join(home,'AppData','Local'),XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),XDG_DATA_HOME:join(home,'.local','share'),TEMP:join(home,'tmp'),TMP:join(home,'tmp'),TMPDIR:join(home,'tmp'),HERMES_HOME:join(home,'.hermes'),OMB_DATA_DIR:home,OMB_PORT:new URL(fixture.info.url).port,OMB_WEBHOOK_PORT:String(Number(new URL(fixture.info.url).port)+1),PATH:dirname(process.execPath)});
const log=openSync(fixture.info.logPath,'a');
const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{cwd:resolve('.'),env,stdio:['ignore',log,log],windowsHide:true});closeSync(log);
const out=resolve('docs/verification/evidence/api-mcp-20260913/glm');mkdirSync(out,{recursive:true});
writeFileSync(join(out,'fixture.json'),JSON.stringify({...fixture.info,pid:child.pid,driver:'claudeAgent',cli,version:execFileSync(cli,['--version'],{encoding:'utf8',windowsHide:true}).trim(),model:'glm-5.3',providerOrigin:new URL(provider.ANTHROPIC_BASE_URL).origin},null,2));
function proof(){
 const models=[];
 function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.jsonl'))for(const line of readFileSync(path,'utf8').split('\n')){try{const value=JSON.parse(line);if(value.message?.model)models.push({model:value.message.model,role:value.message.role,sessionId:value.sessionId});}catch{}}}}
 walk(ccHome);writeFileSync(join(out,'provider-models.json'),JSON.stringify({models},null,2));console.log(JSON.stringify({providerModels:models.length}));
}
let closing=false;
async function close(){if(closing)return;closing=true;proof();await waitForExit(child,{signal:'SIGTERM'});await fixture.close();writeFileSync(join(out,'cleanup.json'),JSON.stringify({dataExists:existsSync(home),pid:child.pid,exitCode:child.exitCode,signal:child.signalCode}));process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
createInterface({input:process.stdin}).on('line',line=>{if(line.trim()==='stop')void close();if(line.trim()==='proof')proof();});
console.log(JSON.stringify({...fixture.info,pid:child.pid,model:'CC GLM-5.3'}));
