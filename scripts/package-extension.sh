#!/usr/bin/env bash
# Builds the release archives: the Spec Kit extension (extension.yml at the root, tests left out) and the preset (preset.yml at the root).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/dist"

pack() { # pack <source dir> <name> <version> [rsync excludes...]
  local src="$1" name="$2" version="$3"
  shift 3
  local out="$root/dist/$name-v$version.zip"
  local stage
  stage="$(mktemp -d)"
  rsync -a --exclude __pycache__ --exclude '*.pyc' "$@" "$src/" "$stage/"
  cp "$root/LICENSE" "$root/CHANGELOG.md" "$stage/"
  rm -f "$out"
  (cd "$stage" && zip -qr "$out" .)
  rm -rf "$stage"
  # The same archive under a name without a version: releases/latest/download/<name>.zip always resolves.
  cp "$out" "$root/dist/$name.zip"
  echo "$out"
  echo "$root/dist/$name.zip"
}

extension_version="$(sed -n 's/^  version: "\(.*\)"$/\1/p' "$root/extension/extension.yml" | head -1)"
preset_version="$(sed -n 's/^  version: "\(.*\)"$/\1/p' "$root/preset/preset.yml" | head -1)"
pack "$root/extension" speckit-xref-extension "$extension_version" --exclude tests
pack "$root/preset" speckit-xref-preset "$preset_version"
