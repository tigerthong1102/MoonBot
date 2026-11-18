#!/usr/bin/env bash
set -euo pipefail
output=mobile-artifacts/ios-device
mkdir -p "$output"
xcodebuild archive -project ios/StartupBot.xcodeproj -scheme StartupBot -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath mobile-artifacts/DerivedData-device -archivePath "$output/StartupBot.xcarchive" CODE_SIGNING_ALLOWED=NO -jobs 2
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$output/StartupBot.xcarchive/Products/Applications/StartupBot.app/Info.plist" | grep -qx ai.startupbot.ios
/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$output/StartupBot.xcarchive/Products/Applications/StartupBot.app/Info.plist" | grep -qx iPhoneOS
lipo "$output/StartupBot.xcarchive/Products/Applications/StartupBot.app/StartupBot" -verify_arch arm64
ditto -c -k --zlibCompressionLevel 9 --keepParent "$output/StartupBot.xcarchive" "$output/StartupBot-0.1.2-build12-DEVICE-UNSIGNED.xcarchive.zip"
rm -rf "$output/StartupBot.xcarchive"
git rev-parse HEAD > "$output/COMMIT.txt"
cp ios/LICENSE ios/NOTICE docs/STARTUPBOT_MOBILE_INTERNAL.md "$output/"
printf '{"qualification":"device-sdk-release-archive-build-only","signing":"UNSIGNED","installation":"BLOCKED: owner provisioning required","TestFlight":"NOT UPLOADED"}\n' > "$output/qualification.json"
(cd "$output" && shasum -a 256 *.zip > SHA256SUMS.txt)
