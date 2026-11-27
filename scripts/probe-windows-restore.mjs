import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const temp = mkdtempSync(join(tmpdir(),"owned-sqlite-probe"));
const file = join(temp, "fixture.sqlite");
writeFileSync(file, "synthetic fixture");
const env = {};
for (const key of ["SYSTEMROOT","WINDIR","COMSPEC","PATHEXT","LANG","TZ"]) if (process.env[key]) env[key]=process.env[key];
Object.assign(env,{HOME:temp,USERPROFILE:temp,TEMP:temp,TMP:temp,PATH:dirname(process.execPath),STARTUPBOT_RESTORE_PATHS:JSON.stringify([file]),STARTUPBOT_RESTORE_FILE_0:file});
const exe=join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe");
for (const [kind, script] of [["json","foreach ($file in (ConvertFrom-Json $env:STARTUPBOT_RESTORE_PATHS)) { $h=[IO.File]::Open($file,'Open','Read','None'); $h.Dispose() }"],["native","$f=[Environment]::GetEnvironmentVariable('STARTUPBOT_RESTORE_FILE_0'); $h=[IO.File]::Open($f,'Open','Read','None'); $h.Dispose()"]]) {
 const t=Date.now();const r=spawnSync(exe,["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop'; "+script],{env,timeout:10000,encoding:"utf8"});
 console.log(kind,Date.now()-t,r.status,r.signal,r.error?.code,r.stderr?.slice(0,400),r.stdout?.slice(0,400));
}
