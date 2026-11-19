#!/bin/bash
set -euo pipefail
[[ ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == macOS ]] || exit 2
dir=$(mktemp -d "$RUNNER_TEMP/fixture-signing.XXXXXX")
cd "$dir"
cat > certificate.cnf <<'CERT'
[req]
prompt = no
distinguished_name = subject
[subject]
CN = StartupBot Fixture CA
[ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
CERT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout root.key -out root.crt -config certificate.cnf -extensions ca
openssl req -new -newkey rsa:2048 -nodes -keyout signing.key -out signing.csr -subj '/CN=StartupBot Update Fixture'
openssl x509 -req -days 1 -sha256 -in signing.csr -CA root.crt -CAkey root.key -CAcreateserial -out signing.crt -extfile certificate.cnf -extensions signing
pass=$(openssl rand -hex 24)
openssl pkcs12 -export -out signing.p12 -inkey signing.key -in signing.crt -certfile root.crt -password "pass:$pass" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg SHA1
keychain="$dir/fixture.keychain-db"
security create-keychain -p "$pass" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$pass" "$keychain"
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security import signing.p12 -k "$keychain" -P "$pass" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pass" "$keychain" >/dev/null
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain root.crt
thumb=$(openssl x509 -in signing.crt -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')
identities=$(security find-identity -v -p codesigning "$keychain")
printf '%s\n' "$identities"
[[ "$identities" == *"$thumb"* ]]
printf 'STARTUPBOT_SMOKE_CERT=%s\nSTARTUPBOT_SMOKE_KEYCHAIN=%s\n' "$thumb" "$keychain" >> "$GITHUB_ENV"
