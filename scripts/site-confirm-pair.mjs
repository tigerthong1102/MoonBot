import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { phonePairingLink } from '../packages/phone-protocol/src/pairing-link.ts';
const token = randomBytes(32).toString('base64url');
const home = mkdtempSync(join(tmpdir(),'site-phone-'));
const env = {...process.env, HOME:home, USERPROFILE:home, OMB_DATA_DIR:join(home,'workspace'), OMB_CONTROL_TOKEN:token, OMB_COMPANION_DIR:join(home,'phones'), OMB_COMPANION_NAME:'StartupBot QA', OMB_COMPANION_BONJOUR:'0', OMB_COMPANION_ROUTES:'wifi', OMB_CONTROL_PORT:'19811', OMB_COMPANION_PORT:'19810', OMB_PORT:'19808', OMB_WEBHOOK_PORT:'19809'};
mkdirSync(env.OMB_DATA_DIR);
const resources = dirname(dirname(process.env.SITE_COMPANION));
const launch = script => spawn(process.execPath,[script],{env,stdio:'ignore'});
const host = launch(join(resources,'server','index.js'));
const child = launch(process.env.SITE_COMPANION);
const ctl = async (method,route) => {
 const r=await fetch('http://127.0.0.1:19811'+route,{method,headers:{'x-openmausbot-control-token':token},signal:AbortSignal.timeout(2500)});
 assert(r.ok);return r.json()
};
const exec = (cmd,args) => { const result=spawnSync(cmd,args,{stdio:['ignore','pipe','pipe']}); if(result.status!==0) throw Error(cmd+' failed with status '+result.status); };
try {
 let ready=false;
 for(let i=0;i<90&&!ready;i++){
   if(host.exitCode!==null||child.exitCode!==null) throw Error('Packaged workspace or companion stopped before ready');
   await wait(500);
   try { const r=await fetch('http://127.0.0.1:19810/api/health',{signal:AbortSignal.timeout(2000)}); ready=r.ok&&(await r.json()).app==='openmausbot'; } catch {}
 }
 assert(ready,'Packaged workspace identity over the companion route');
 const pending=await ctl('POST','/pairing');
 assert(pending?.token);
 const url=phonePairingLink({address:'127.0.0.1',port:19810,name:'StartupBot QA',token:pending.token});
 assert(url?.startsWith('startupbot://pair?'));
 if(process.argv[2]==='android'){
   exec('adb',['reverse','tcp:19810','tcp:19810']);
   exec('adb',['shell','am','start','-W','-a','android.intent.action.VIEW','-d',"'"+url+"'"]);
   exec('python3',['scripts/site-tap-android.py']);
 } else {
   exec('xcrun',['simctl','openurl',process.argv[2],url]);
   execFileSync('xcodebuild',['test-without-building','-project','touch/Touch.xcodeproj','-scheme','Touch','-derivedDataPath','touch/build','-destination','id='+process.argv[2],'-parallel-testing-enabled','NO','CODE_SIGN_IDENTITY=-'],{stdio:'inherit'});
 }
 let device;
 for(let i=0;i<45&&!device;i++){await wait(600);device=(await ctl('GET','/state')).devices[0]}
 assert(device?.id,'The native client did not redeem its invitation');
 await ctl('DELETE','/devices/'+encodeURIComponent(device.id));
 assert.equal((await ctl('GET','/state')).devices.length,0);
 console.log('PASS native device registered by companion and revoked');
}finally{child.kill();host.kill()}
