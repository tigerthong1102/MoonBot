#!/usr/bin/env bash
# Isolated loopback SSH repository and a local container. No saved SSH hosts are contacted.
set -euo pipefail
fixture=$(mktemp -d)
sshd_pid=
forward_pid=
container=
cleanup() {
  if [[ -n "$forward_pid" ]]; then kill "$forward_pid" 2>/dev/null || true; fi
  if [[ -n "$sshd_pid" ]]; then kill "$sshd_pid" 2>/dev/null || true; fi
  if [[ -n "$container" ]]; then docker stop --time 1 "$container" >/dev/null || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT
repo="$fixture/repo with spaces"
git init --quiet "$repo"
echo "committed in fixture" > "$repo/deliverable.txt"
git -C "$repo" add deliverable.txt
git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm seed
git -C "$repo" rev-parse HEAD > "$fixture/head"
cli=(node --experimental-strip-types server/openmausbot.ts dev)
if [[ "${1:-all}" != docker ]]; then
  ssh_port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  ssh-keygen -q -t ed25519 -N '' -f "$fixture/server_key"
  ssh-keygen -q -t ed25519 -N '' -f "$fixture/client_key"
  printf '[127.0.0.1]:%s %s\n' "$ssh_port" "$(cat "$fixture/server_key.pub")" > "$fixture/known_hosts"
  cat > "$fixture/sshd_config" <<CFG
ListenAddress 127.0.0.1
Port $ssh_port
HostKey $fixture/server_key
AuthorizedKeysFile $fixture/client_key.pub
StrictModes no
PidFile $fixture/sshd.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers $(id -un)
CFG
  cat > "$fixture/ssh_config" <<CFG
Host fixture
  HostName 127.0.0.1
  Port $ssh_port
  User $(id -un)
  IdentitiesOnly yes
  IdentityFile $fixture/client_key
  UserKnownHostsFile $fixture/known_hosts
CFG
  /usr/sbin/sshd -D -e -f "$fixture/sshd_config" > "$fixture/sshd.log" 2>&1 &
  sshd_pid=$!
  for ignored in $(seq 1 40); do
    if ssh -F "$fixture/ssh_config" -o StrictHostKeyChecking=yes -o BatchMode=yes fixture true 2>/dev/null; then break; fi
    sleep 0.2
  done
  "${cli[@]}" host status --host fixture --config "$fixture/ssh_config" --folder "$repo" --json > "$fixture/result" || { cat "$fixture/sshd.log"; exit 1; }
  node -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1])).head!==fs.readFileSync(process.argv[2],"utf8").trim())process.exit(1)' "$fixture/result" "$fixture/head"
  local_port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  "${cli[@]}" host forward --host fixture --config "$fixture/ssh_config" --local "$local_port" --port "$ssh_port" --connect > "$fixture/forward" 2>&1 &
  forward_pid=$!
  node - "$local_port" <<'JS'
const net=require('net'); let tries=0;
function probe(){const s=net.connect(+process.argv[2],'127.0.0.1');s.setTimeout(2000,()=>s.destroy());s.once('data',data=>{if(!data.toString().startsWith('SSH-'))process.exitCode=1;s.destroy()});s.on('error',()=>{if(++tries<40)setTimeout(probe,200);else process.exitCode=1})}probe();
JS
  echo "Verified exact remote Git head and a loopback-only SSH preview."
fi
if [[ "${1:-all}" != ssh ]]; then
  image=${STARTUPBOT_QA_IMAGE:?Set STARTUPBOT_QA_IMAGE to a local test image with sleep and cat}
  "${cli[@]}" sandbox start --repo "$repo" --image "$image" --minutes 1 --json > "$fixture/result"
  container=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$fixture/result")
  test "$(docker exec "$container" cat /workspace/deliverable.txt)" = "committed in fixture"
  test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
  "${cli[@]}" sandbox stop --repo "$repo" --id "$container" --json > /dev/null
  container=
  echo "Verified Docker task checkout contents, network isolation and scoped cleanup."
fi
