#!/usr/bin/env bash
set -euo pipefail
mkdir -p mobile-artifacts/ios
python3 scripts/mobile-command.py 30 xcrun simctl list devices available --json > mobile-artifacts/ios/devices.json
xcrun --sdk iphonesimulator --show-sdk-version > mobile-artifacts/ios/sdk-version.txt
selection="$(python3 - <<'PYSELECT'
import json
x=json.load(open('mobile-artifacts/ios/devices.json'))
sdk=open('mobile-artifacts/ios/sdk-version.txt').read().strip().replace('.', '-')
for runtime,devices in x['devices'].items():
    if not runtime.endswith('iOS-'+sdk): continue
    for d in devices:
        if d.get('isAvailable') and d['name'].startswith('iPhone'):
            print(d['deviceTypeIdentifier'],runtime);raise SystemExit
raise SystemExit('No iPhone simulator runtime matches the selected Xcode SDK')
PYSELECT
)"
read -r device_type runtime <<< "$selection"
printf '%s\n' "$selection" > mobile-artifacts/ios/selected-runtime.txt
simulator_id="$(python3 scripts/mobile-command.py 30 xcrun simctl create "StartupBotInternal-${GITHUB_RUN_ID:-local}" "$device_type" "$runtime")"
cleanup() {
  outcome=$?
  if [[ "$outcome" != 0 ]]; then
    python3 scripts/mobile-command.py 30 xcrun simctl spawn "$simulator_id" log show --last 10m --style compact --predicate 'process == "StartupBot" OR process == "SpringBoard" OR process == "runningboardd" OR process == "amfid" OR process == "launchd_sim"' > mobile-artifacts/ios/simulator-system.log 2>&1 || true
    python3 scripts/mobile-command.py 30 xcrun simctl io "$simulator_id" screenshot mobile-artifacts/ios/failed-launch.png || true
    mkdir -p mobile-artifacts/ios/crashes
    find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -name 'StartupBot*' -exec cp {} mobile-artifacts/ios/crashes/ \; 2>/dev/null || true
  fi
  python3 scripts/mobile-command.py 30 xcrun simctl shutdown "$simulator_id" || true
  python3 scripts/mobile-command.py 30 xcrun simctl delete "$simulator_id" || true
  exit "$outcome"
}
trap cleanup EXIT
python3 scripts/mobile-command.py 900 xcodebuild build-for-testing -project ios/StartupBot.xcodeproj -scheme StartupBot -configuration Debug -destination "id=$simulator_id" -destination-timeout 30 -derivedDataPath mobile-artifacts/DerivedData CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= CODE_SIGN_LOCAL_EXECUTION_IDENTITY='Ad Hoc'
python3 scripts/mobile-command.py 30 xcrun simctl boot "$simulator_id"
python3 scripts/mobile-command.py 600 xcrun simctl bootstatus "$simulator_id" -b
app="$PWD/mobile-artifacts/DerivedData/Build/Products/Debug-iphonesimulator/StartupBot.app"
python3 scripts/install-ios-simulator.py "$simulator_id" "$app" mobile-artifacts/ios/installation.json
python3 scripts/mobile-command.py 90 xcrun simctl launch "$simulator_id" ai.startupbot.ios --startupbot-internal-security-smoke 2>&1 | tee mobile-artifacts/ios/launch.txt
data_container="$(python3 scripts/mobile-command.py 30 xcrun simctl get_app_container "$simulator_id" ai.startupbot.ios data)"
for attempt in $(seq 1 30); do
  [[ -f "$data_container/Documents/startupbot-security-smoke.json" ]] && break
  sleep 1
done
cp "$data_container/Documents/startupbot-security-smoke.json" mobile-artifacts/ios/security-smoke.json
node -e 'const r=require("./mobile-artifacts/ios/security-smoke.json"); if(r.status!=="PASS") throw Error(JSON.stringify(r))'
python3 scripts/mobile-command.py 30 xcrun simctl io "$simulator_id" screenshot mobile-artifacts/ios/startupbot-ios.png
python3 scripts/mobile-command.py 900 xcodebuild test-without-building -project ios/StartupBot.xcodeproj -scheme StartupBot -configuration Debug -destination "id=$simulator_id" -derivedDataPath mobile-artifacts/DerivedData -resultBundlePath mobile-artifacts/ios/Navigation.xcresult CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= CODE_SIGN_LOCAL_EXECUTION_IDENTITY='Ad Hoc'
printf '{"status":"PASS","scope":"Simulator installation, launch and native navigation UI tests","pairing":"NOT RUN","physicalDevice":"NOT RUN"}\n' > mobile-artifacts/ios/smoke.json
