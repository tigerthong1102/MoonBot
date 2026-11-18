#!/usr/bin/env bash
set -euo pipefail
native_arch="$(uname -m)"
native_output="mobile-artifacts/ios-$native_arch/StartupBot.app"
rm -rf "$native_output"
ditto mobile-artifacts/DerivedData/Build/Products/Debug-iphonesimulator/StartupBot.app "$native_output"
node scripts/verify-ios-simulator.mjs "$native_output" "$native_arch" "mobile-artifacts/ios-$native_arch"
for arch in arm64 x86_64; do
  output="mobile-artifacts/ios-$arch"
  archive="StartupBot-0.1.2-build15-$arch-SIMULATOR.zip"
  ditto -c -k --zlibCompressionLevel 9 --keepParent "$output/StartupBot.app" "$output/$archive"
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/startupbot-simulator-payload.XXXXXX")"
  trap 'rm -rf "$temporary"' EXIT
  ditto -x -k "$output/$archive" "$temporary"
  node scripts/package-payload.mjs --source "$output/StartupBot.app" --installed "$temporary/StartupBot.app" --report "$output/payload-integrity.json"
  rm -rf "$temporary" "$output/StartupBot.app"
  trap - EXIT
  cp ios/LICENSE ios/NOTICE docs/STARTUPBOT_MOBILE_INTERNAL.md "$output/"
  cp -R mobile-artifacts/ios "$output/evidence"
  git rev-parse HEAD > "$output/COMMIT.txt"
  if [[ "$arch" == "$(uname -m)" ]]; then qualification=native-simulator-smoke-pass; else qualification=build-only; fi
  printf '{"architecture":"%s","qualification":"%s","physicalDevice":"NOT RUN","storeSigning":"NOT CONFIGURED"}\n' "$arch" "$qualification" > "$output/qualification.json"
  (cd "$output" && shasum -a 256 "$archive" > SHA256SUMS.txt)
done
