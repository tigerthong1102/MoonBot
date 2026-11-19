import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { phonePairingLink } from '../packages/phone-protocol/src/pairing-link.ts';
const token = randomBytes(32).toString('base64url');
const home = mkdtempSync(join(tmpdir(),'site-phone-'));
const child = spawn(process.execPath,[process.env.SITE_COMPANION], {stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:home,OMB_CONTROL_TOKEN:token,OMB_COMPANION_DIR:home,OMB_COMPANION_NAME:'StartupBot QA',OMB_COMPANION_BONJOUR:'0',OMB_COMPANION_ROUTES:'wifi',OMB_CONTROL_PORT:'19811',OMB_COMPANION_PORT:'19810',OMB_PORT:'19808',OMB_WEBHOOK_PORT:'19809'}});
let childError=''; child.stderr.on('data',b=>{childError=(childError+String(b)).slice(-2000)});
const ctl = async (method,route) => {
 const r=await fetch('http://127.0.0.1:19811'+route,{method,headers:{'x-openmausbot-control-token':token},signal:AbortSignal.timeout(2500)});
 assert(r.ok);return r.json()
};
const exec = (cmd,args) => execFileSync(cmd,args,{stdio:['ignore','pipe','pipe']}).toString();
try {
 let pending;
 for(let i=0;i<60&&!pending;i++){await wait(300);try{pending=await ctl('POST','/pairing')}catch{if(child.exitCode!==null)throw Error('Fixture stopped: '+childError.replace(/omb_(?:pair_)?[A-Za-z0-9_-]+/g,'[redacted]'))}}
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
}finally{child.kill()}
