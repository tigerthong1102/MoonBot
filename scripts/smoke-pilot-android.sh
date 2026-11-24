#!/usr/bin/env bash
set -euo pipefail
apk=(android/app/build/outputs/apk/debug/*universal*.apk)
test "${#apk[@]}" = 1
test -f "${apk[0]}"
sdk="$ANDROID_HOME/cmdline-tools/latest/bin"
build_tools="$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 | sort -V | tail -1)"
test -x "$build_tools"
"$build_tools" dump badging "${apk[0]}" > "$RUNNER_TEMP/pilot-apk.txt"
grep -F "name='ai.startupbot.android' versionCode='10001' versionName='1.0.1'" "$RUNNER_TEMP/pilot-apk.txt"
"$build_tools" dump resources "${apk[0]}" > "$RUNNER_TEMP/pilot-resources.txt"
grep -F "$STARTUPBOT_INBOX_ORIGIN" "$RUNNER_TEMP/pilot-resources.txt" >/dev/null
image="system-images;android-35;google_apis;x86_64"
"$sdk/sdkmanager" --install "$image" emulator platform-tools
echo no | "$sdk/avdmanager" create avd -n StartupBotPilot -k "$image"
sudo chown "$USER" /dev/kvm
"$ANDROID_HOME/emulator/emulator" -avd StartupBotPilot -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -memory 2500 > "$RUNNER_TEMP/emulator.log" 2>&1 &
emulator_pid=$!
trap 'adb emu kill >/dev/null 2>&1 || kill "$emulator_pid" 2>/dev/null || true; tail -25 "$RUNNER_TEMP/emulator.log"' EXIT
timeout 200 adb wait-for-device
for i in $(seq 1 100); do
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]]; then break; fi
  sleep 2
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1
adb shell input keyevent 82
adb install "${apk[0]}"
adb shell cmd locale set-app-locales ai.startupbot.android --user 0 --locales vi-VN
adb shell cmd locale get-app-locales ai.startupbot.android --user 0 | grep -F vi-VN
activity="$(sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p" "$RUNNER_TEMP/pilot-apk.txt" | head -1)"
test -n "$activity"
adb shell am start -W -n "ai.startupbot.android/$activity" | tee "$RUNNER_TEMP/pilot-launch.txt"
grep -F 'Status: ok' "$RUNNER_TEMP/pilot-launch.txt"
sleep 5
adb shell pidof ai.startupbot.android
adb shell uiautomator dump /sdcard/startupbot-ui.xml
adb pull /sdcard/startupbot-ui.xml "$RUNNER_TEMP/pilot-android-ui.xml"
grep -F 'package="ai.startupbot.android"' "$RUNNER_TEMP/pilot-android-ui.xml" >/dev/null
adb exec-out screencap -p > "$RUNNER_TEMP/pilot-android.png"
