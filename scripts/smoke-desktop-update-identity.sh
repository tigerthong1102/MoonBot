#!/bin/bash
set -euo pipefail
[[ ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == macOS ]] || exit 2
dir=$(mktemp -d "$RUNNER_TEMP/fixture-signing.XXXXXX")
cd "$dir"
cat > extensions.cnf <<'CERT'
[req]
prompt = no
distinguished_name = subject
x509_extensions = signing
[subject]
CN = StartupBot Update Fixture
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CERT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout signing.key -out signing.crt -config extensions.cnf
pass=$(openssl rand -hex 24)
openssl pkcs12 -export -out signing.p12 -inkey signing.key -in signing.crt -password "pass:$pass" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg SHA1
keychain="$dir/fixture.keychain-db"
security create-keychain -p "$pass" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$pass" "$keychain"
security import signing.p12 -k "$keychain" -P "$pass" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pass" "$keychain"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain signing.crt
thumb=$(openssl x509 -in signing.crt -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')
printf 'STARTUPBOT_SMOKE_CERT=%s\nSTARTUPBOT_SMOKE_KEYCHAIN=%s\n' "$thumb" "$keychain" >> "$GITHUB_ENV"
