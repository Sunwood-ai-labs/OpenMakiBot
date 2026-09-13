import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sharedCommand } from '../electron/shared-computer-access.mjs';

const fixtureHome = mkdtempSync(join(tmpdir(), 'omb-shared-command-'));
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
const allowed = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG'];
const minimal = Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
const started = Date.now();
try {
  const result = await sharedCommand('echo shared-desktop-ok', fixtureHome, AbortSignal.timeout(12_000));
  console.log(JSON.stringify({name:'production', elapsed:Date.now()-started, result}));
} catch(error) { console.log(JSON.stringify({name:'production',elapsed:Date.now()-started,error:error.message})); }

async function probe(name, command, extra = {}) {
  const start = Date.now();
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd:fixtureHome, windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...minimal,...extra},
  });
  const timer = setTimeout(() => {
    console.log(JSON.stringify({name,event:'deadline',elapsed:Date.now()-start}));
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  }, 10_000);
  for(const [stream,label] of [[child.stdout,'stdout'],[child.stderr,'stderr']]) {
    stream.on('data',b=>console.log(JSON.stringify({name,event:label,elapsed:Date.now()-start,text:b.toString().slice(0,1000)})));
  }
  child.on('exit',code=>console.log(JSON.stringify({name,event:'exit',code,elapsed:Date.now()-start})));
  await new Promise(resolve=>{
    child.on('error',error=>{console.log(JSON.stringify({name,event:'error',message:error.message}));clearTimeout(timer);resolve();});
    child.on('close',code=>{console.log(JSON.stringify({name,event:'close',code,elapsed:Date.now()-start}));clearTimeout(timer);resolve();});
  });
}
console.log(JSON.stringify({environmentKeys:Object.keys(minimal)}));
const command='[Console]::Out.WriteLine("entered"); echo shared-desktop-ok; [Console]::Out.WriteLine("finished")';
await probe('minimal-markers',command);
await probe('console-only','[Console]::Out.WriteLine("shared-desktop-ok")');
for(const key of ['WINDIR','COMSPEC','PSModulePath']) {
  await probe(`with-${key}`, command, process.env[key]?{[key]:process.env[key]}:{});
}
