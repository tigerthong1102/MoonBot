#!/bin/zsh
set -eu
umask 077
resources=/Applications/StartupBot.app/Contents/Resources
profile="$HOME/Library/Application Support/StartupBot Web Preview"
label=ai.startupbot.web-preview.local
node_bin=$(command -v node || true)
if [[ -z "$node_bin" && -x /opt/homebrew/bin/node ]]; then node_bin=/opt/homebrew/bin/node; fi
if [[ ! -x "$node_bin" || ! -f "$resources/ui/index.html" || ! -f "$resources/server/desktop-entry.mjs" ]]; then
  echo "Cần StartupBot trong Applications và Node.js để chạy workspace thử trên máy này."
  exit 1
fi
mkdir -p "$profile"/{data,home,tmp}
if ! launchctl list "$label" >/dev/null 2>&1; then
  if /usr/sbin/lsof -nP -iTCP:18868 -iTCP:18869 -sTCP:LISTEN >/dev/null; then
    echo "Cổng thử nghiệm đang được một dịch vụ khác sử dụng."
    exit 1
  fi
  launchctl submit -l "$label" -o "$profile/server.log" -e "$profile/error.log" -- /usr/bin/env -i \
    "HOME=$profile/home" "USERPROFILE=$profile/home" "TMPDIR=$profile/tmp" \
    "PATH=${node_bin:h}:/usr/bin:/bin" "OMB_DATA_DIR=$profile/data" "OMB_STATIC_DIR=$resources/ui" \
    OMB_PORT=18868 OMB_WEBHOOK_PORT=18869 OMB_DISABLE_ANNOUNCEMENTS=1 OMB_LAN=0 \
    "$node_bin" "$resources/server/desktop-entry.mjs"
fi
for attempt in {1..20}; do
  pid=$(launchctl list "$label" | awk '/"PID" =/{gsub(/;/,"",$3);print $3}')
  if [[ -n "$pid" ]] && /usr/sbin/lsof -a -nP -p "$pid" -iTCP:18868 -sTCP:LISTEN -Fn | /usr/bin/grep -qx 'n127.0.0.1:18868'; then
    "$node_bin" --input-type=module <<'JS'
import {execFileSync} from 'node:child_process';
const origin = 'http://127.0.0.1:18868';
const r = await fetch(origin+'/api/auth/pairing',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'StartupBot Web Preview',ttlMs:60000,tokenTtlMs:28800000})});
if (!r.ok) throw Error('StartupBot refused pairing ('+r.status+')');
const {code} = await r.json();
if (!/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/.test(code)) throw Error('Invalid invitation');
execFileSync('/usr/bin/open',[origin+'/pair#code='+code]);
JS
    exit $?
  fi
  sleep 0.5
done
echo "Workspace chưa khởi động được. Xem $profile/error.log."
exit 1
