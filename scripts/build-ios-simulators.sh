#!/usr/bin/env bash
set -euo pipefail
for arch in arm64 x86_64; do
  derived="mobile-artifacts/DerivedData-$arch"
  output="mobile-artifacts/ios-$arch"
  xcodebuild build -project ios/StartupBot.xcodeproj -scheme StartupBot -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" ARCHS="$arch" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= CODE_SIGN_LOCAL_EXECUTION_IDENTITY='Ad Hoc' -jobs 2
  mkdir -p "$output"
  ditto "$derived/Build/Products/Debug-iphonesimulator/StartupBot.app" "$output/StartupBot.app"
  node scripts/verify-ios-simulator.mjs "$output/StartupBot.app" "$arch" "$output"
done
ln -s "DerivedData-$(uname -m)" mobile-artifacts/DerivedData
