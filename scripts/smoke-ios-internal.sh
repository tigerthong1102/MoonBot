#!/usr/bin/env bash
set -euo pipefail
mkdir -p mobile-artifacts/ios
xcrun simctl list devices available --json > mobile-artifacts/ios/devices.json
simulator_id="$(python3 - <<'PY'
import json
x=json.load(open('mobile-artifacts/ios/devices.json'))
for runtime,devices in x['devices'].items():
    if '.iOS-' not in runtime: continue
    for d in devices:
        if d.get('isAvailable') and d['name'].startswith('iPhone'):
            print(d['udid']);raise SystemExit
raise SystemExit('No iPhone simulator runtime installed')
PY
)"
xcrun simctl boot "$simulator_id"
trap 'xcrun simctl shutdown "$simulator_id" || true' EXIT
xcrun simctl bootstatus "$simulator_id" -b
app="$PWD/mobile-artifacts/DerivedData/Build/Products/Debug-iphonesimulator/StartupBot.app"
xcrun simctl install "$simulator_id" "$app"
xcrun simctl launch "$simulator_id" ai.startupbot.ios --startupbot-internal-security-smoke | tee mobile-artifacts/ios/launch.txt
sleep 4
data_container="$(xcrun simctl get_app_container "$simulator_id" ai.startupbot.ios data)"
cp "$data_container/Documents/startupbot-security-smoke.json" mobile-artifacts/ios/security-smoke.json
node -e 'const r=require("./mobile-artifacts/ios/security-smoke.json"); if(r.status!=="PASS") throw Error(JSON.stringify(r))'
xcrun simctl io "$simulator_id" screenshot mobile-artifacts/ios/startupbot-ios.png
xcodebuild test -project ios/StartupBot.xcodeproj -scheme StartupBot -configuration Debug -destination "id=$simulator_id" -derivedDataPath mobile-artifacts/UITestDerivedData -resultBundlePath mobile-artifacts/ios/Navigation.xcresult CODE_SIGNING_ALLOWED=NO
printf '{"status":"PASS","scope":"Simulator installation, launch and native navigation UI tests","pairing":"NOT RUN","physicalDevice":"NOT RUN"}\n' > mobile-artifacts/ios/smoke.json
