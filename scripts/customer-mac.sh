#!/bin/bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
die() { printf '%s\n' "$*" >&2; exit 1; }

verify_image() (
  image=$1
  team=$2
  phase=$3
  [[ $team =~ ^[A-Z0-9]{10}$ ]] || die "Invalid Apple Team ID."
  hdiutil verify "$image" >/dev/null
  requirement="anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$team\""
  codesign --verify --strict -R "=$requirement" "$image"
  mount=$(mktemp -d)
  trap 'rmdir "$mount"' EXIT
  hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image" >/dev/null
  trap 'hdiutil detach "$mount" >/dev/null && rmdir "$mount"' EXIT
  app="$mount/StartupBot.app"
  codesign --verify --deep --strict "$app"
  codesign --verify --strict -R "=$requirement and identifier \"ai.startupbot.desktop\"" "$app"
  if [[ $phase == distribution ]]; then
    xcrun stapler validate "$image"
    spctl --assess --type open --context context:primary-signature "$image"
    spctl --assess --type execute "$app"
  fi
)

case ${1:-} in
  verify)
    [[ $# == 3 ]] || die "Usage: customer-mac.sh verify /path/to/StartupBot.dmg TEAM_ID"
    verify_image "$2" "$3" distribution
    exit ;;
  build|preflight) ;;
  *) die "Use preflight, build, or verify." ;;
esac

[[ $# == 1 ]] || die "Set STARTUPBOT_SIGNING_SHA1 and STARTUPBOT_NOTARY_PROFILE in the signing environment."
requested=$(printf '%s' "${STARTUPBOT_SIGNING_SHA1:-}" | tr '[:lower:]' '[:upper:]')
[[ -z $requested || $requested =~ ^[A-F0-9]{40}$ ]] || die "Invalid certificate fingerprint."
identities=$(security find-identity -v -p codesigning | awk -v key="$requested" '/"Developer ID Application:/ && (key == "" || $2 == key)')
[[ -n $identities ]] || die "No valid Developer ID Application identity with a private key in the signing keychain."
[[ $identities != *$'\n'* ]] || die "Multiple signing identities. Select one with STARTUPBOT_SIGNING_SHA1."
fingerprint=$(awk '{print $2}' <<< "$identities")
[[ $identities =~ \(([[:alnum:]]{10})\)\"$ ]] || die "Could not read the Apple Team ID."
team=${BASH_REMATCH[1]}
profile=${STARTUPBOT_NOTARY_PROFILE:-startupbot-notary}
xcrun notarytool history --keychain-profile "$profile" --output-format json >/dev/null
[[ $1 == build ]] || exit 0
[[ $(uname -m) == arm64 ]] || die "Build and launch-test this Apple Silicon package on arm64."
mkdir -p release
out=$(mktemp -d "$root/release/signing-arm64.XXXXXX")
pnpm install --frozen-lockfile
pnpm package:prepare
pnpm build:speech
pnpm build:cua
STARTUPBOT_SIGNED_ARCH=arm64 pnpm exec electron-builder --config electron-builder.updates.cjs --mac dmg zip --arm64 --publish never \
  "-c.directories.output=$out" "-c.mac.identity=$fingerprint"
images=("$out"/*.dmg)
[[ ${#images[@]} == 1 && -f ${images[0]} ]] || die "Expected one DMG."
image=${images[0]}
verify_image "$image" "$team" signed
xcrun notarytool submit "$image" --keychain-profile "$profile" --wait --output-format json > "$out/notary.json"
[[ $(plutil -extract status raw -o - "$out/notary.json") == Accepted ]] || die "Apple did not accept the DMG. See $out/notary.json."
for attempt in 1 2 3 4 5 6; do
  if xcrun stapler staple "$image"; then break; fi
  [[ $attempt != 6 ]] || die "Stapling failed. Notary receipt: $out/notary.json."
  sleep 30
done
verify_image "$image" "$team" distribution
mount=$(mktemp -d)
trap 'rmdir "$mount"' EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image" >/dev/null
trap 'hdiutil detach "$mount" >/dev/null && rmdir "$mount"' EXIT
installed="$out/installed/StartupBot.app"
mkdir "$out/installed"
ditto "$mount/StartupBot.app" "$installed"
hdiutil detach "$mount" >/dev/null
rmdir "$mount"
trap - EXIT
archive="$out/StartupBot-$(node -p 'require("./package.json").version')-arm64.zip"
mkdir "$out/zip-verify"
ditto -x -k "$archive" "$out/zip-verify"
zip_app="$out/zip-verify/StartupBot.app"
codesign --verify --deep --strict "$zip_app"
codesign --verify --strict -R "=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$team\" and identifier \"ai.startupbot.desktop\"" "$zip_app"
spctl --assess --type execute "$zip_app"
node scripts/desktop-update-manifest.mjs "$out" darwin arm64
node scripts/package-payload.mjs --source "$out/mac-arm64/StartupBot.app" --installed "$installed" --report "$out/payload.json"
node scripts/smoke-internal-desktop.mjs --app "$installed" --output "$out/smoke"
mkdir "$out/customer"
cp docs/startupbot/install-mac.vi.md "$out/customer/HUONG-DAN.md"
mv "$image" "$out/customer/"
(cd "$out/customer" && shasum -a 256 ./*.dmg > SHA256SUMS.txt)
printf 'Customer files: %s/customer\n' "$out"
