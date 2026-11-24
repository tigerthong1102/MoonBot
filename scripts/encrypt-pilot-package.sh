#!/usr/bin/env bash
set -euo pipefail
umask 077
package=$1
platform=$2
output="pilot-artifacts/$platform"
mkdir -p "$output"
keys=$(mktemp -d)
trap 'rm -rf "$keys"' EXIT
printf '%s' "$PILOT_ARTIFACT_PUBLIC_KEY" | openssl base64 -d -A > "$keys/public.pem"
openssl rand -hex 32 > "$keys/passphrase"
openssl pkeyutl -encrypt -pubin -inkey "$keys/public.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$keys/passphrase" -out "$output/passphrase.rsa"
name=$(basename "$package")
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$package" -out "$output/$name.enc" -pass "file:$keys/passphrase"
openssl dgst -sha256 -binary "$package" > "$output/sha256"
