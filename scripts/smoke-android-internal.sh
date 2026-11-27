#!/usr/bin/env bash
set -euo pipefail
mkdir -p mobile-artifacts/android
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
sdkmanager 'system-images;android-35;google_apis;x86_64' 'emulator'
export ANDROID_AVD_HOME="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/startupbot-internal-avd"
mkdir -p "$ANDROID_AVD_HOME"
printf 'no\n' | avdmanager create avd -n StartupBotInternal -p "$ANDROID_AVD_HOME/StartupBotInternal.avd" -k 'system-images;android-35;google_apis;x86_64' --device pixel_6 --force
emulator -list-avds | tee mobile-artifacts/android/avds.txt
grep -qx StartupBotInternal mobile-artifacts/android/avds.txt
emulator -avd StartupBotInternal -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -camera-back none -camera-front none > mobile-artifacts/android/emulator.log 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" 2>/dev/null || true' EXIT
timeout 180s adb wait-for-device
booted=0
for attempt in $(seq 1 180); do
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then booted=1; break; fi
  sleep 1
done
[[ "$booted" == 1 ]]
adb shell input keyevent 82
adb install -r android/app/build/outputs/apk/debug/app-x86_64-debug.apk
adb logcat -c
adb shell am start -W -n ai.startupbot.android/com.openmausbot.companion.MainActivity | tee mobile-artifacts/android/launch.txt
sleep 4
adb shell pidof ai.startupbot.android > mobile-artifacts/android/pid.txt
test -s mobile-artifacts/android/pid.txt
adb shell uiautomator dump /sdcard/startupbot-ui.xml
adb pull /sdcard/startupbot-ui.xml mobile-artifacts/android/ui.xml
grep -q 'StartupBot' mobile-artifacts/android/ui.xml
if grep -Eqi 'MausBot|OpenMausMobile' mobile-artifacts/android/ui.xml; then exit 1; fi
adb exec-out screencap -p > mobile-artifacts/android/startupbot-android.png
adb logcat -d > mobile-artifacts/android/logcat.txt
printf '{"status":"PASS","scope":"APK installation, real emulator launch and onboarding branding","pairing":"NOT RUN","liveProvider":"NOT RUN"}\n' > mobile-artifacts/android/smoke.json
node scripts/mobile-qa-evidence.mjs --platform android --device "$(adb get-serialno)" \
  --runtime "$(adb shell getprop ro.build.fingerprint | tr -d '\r')" --revision "$(git rev-parse HEAD)" \
  --build android/app/build/outputs/apk/debug/app-x86_64-debug.apk --directory mobile-artifacts/android
