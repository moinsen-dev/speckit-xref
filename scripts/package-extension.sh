#!/usr/bin/env bash
# Builds the Spec Kit extension's release archive: extension.yml at the archive root, tests left out (.extensionignore).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^  version: "\(.*\)"$/\1/p' "$root/extension/extension.yml" | head -1)"
out="$root/dist/speckit-xref-extension-v$version.zip"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
rsync -a --exclude tests --exclude __pycache__ --exclude '*.pyc' "$root/extension/" "$stage/"
cp "$root/LICENSE" "$root/CHANGELOG.md" "$stage/"
mkdir -p "$root/dist"
rm -f "$out"
(cd "$stage" && zip -qr "$out" .)
# The same archive under a name without a version: releases/latest/download/speckit-xref-extension.zip always resolves.
cp "$out" "$root/dist/speckit-xref-extension.zip"
echo "$out"
echo "$root/dist/speckit-xref-extension.zip"
