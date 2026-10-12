#!/usr/bin/env node
// Sets the release version everywhere it is written: the mod's plugin.json, the marketplace (twice), the extension's
// manifest, the download and Action links in the READMEs and the catalog submission, and the project page's revision.
//   node scripts/bump.mjs <version> [--extension <version>]
// The extension follows the release unless --extension names its own version; the preset keeps its version.
// Historical notes such as "(0.6.1)" in code and docs are never touched. Bumping to the current version changes nothing.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const SEMVER = /^\d+\.\d+\.\d+$/
const version = args[0]
const extFlag = args.indexOf('--extension')
const extension = extFlag >= 0 ? args[extFlag + 1] : version
if (!SEMVER.test(version ?? '') || !SEMVER.test(extension ?? '')) {
  console.error('usage: node scripts/bump.mjs <version> [--extension <version>]')
  process.exit(2)
}

const read = rel => readFileSync(join(root, rel), 'utf8')
const oldTag = JSON.parse(read('mod/.claude-plugin/plugin.json')).version
// The preset keeps its own version; its download links follow preset/preset.yml.
const preset = /^\s+version:\s*"([^"]+)"/m.exec(read('preset/preset.yml'))?.[1]
const oldExt = /^\s+version:\s*"([^"]+)"/m.exec(read('extension/extension.yml'))?.[1]
if (!oldTag || !oldExt) {
  console.error('could not read the current versions from mod/.claude-plugin/plugin.json and extension/extension.yml')
  process.exit(1)
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const edits = {
  'mod/.claude-plugin/plugin.json': [[new RegExp(`("version":\\s*")${esc(oldTag)}"`), `$1${version}"`, 1]],
  '.claude-plugin/marketplace.json': [[new RegExp(`("version":\\s*")${esc(oldTag)}"`, 'g'), `$1${version}"`, 2]],
  'extension/extension.yml': [[new RegExp(`^(\\s+version:\\s*")${esc(oldExt)}"`, 'm'), `$1${extension}"`, 1]],
  'README.md': [
    [new RegExp(`releases/download/v${esc(oldTag)}/`, 'g'), `releases/download/v${version}/`, 2],
    [/speckit-xref-preset-v\d+\.\d+\.\d+\.zip/g, `speckit-xref-preset-v${preset}.zip`, 1],
    [new RegExp(`speckit-xref-extension-v${esc(oldExt)}\\.zip`, 'g'), `speckit-xref-extension-v${extension}.zip`, 1],
    [new RegExp(`speckit-xref/action@v${esc(oldTag)}\\b`, 'g'), `speckit-xref/action@v${version}`, 2],
  ],
  'extension/README.md': [
    [new RegExp(`releases/download/v${esc(oldTag)}/`, 'g'), `releases/download/v${version}/`, 1],
    [new RegExp(`speckit-xref-extension-v${esc(oldExt)}\\.zip`, 'g'), `speckit-xref-extension-v${extension}.zip`, 1],
  ],
  'site/index.html': [
    [new RegExp(`(<span class="rev">)${esc(oldTag)}(</span>)`), `$1${version}$2`, 1],
    [new RegExp(`speckit-xref/action@v${esc(oldTag)}\\b`, 'g'), `speckit-xref/action@v${version}`, 1],
  ],
  'docs/spec-kit-submission.md': [
    [new RegExp(`(\\| Version \\| \`)${esc(oldExt)}(\` \\|)`), `$1${extension}$2`, 1],
    [new RegExp(`releases/download/v${esc(oldTag)}/`, 'g'), `releases/download/v${version}/`, 1],
    [new RegExp(`speckit-xref-extension-v${esc(oldExt)}\\.zip`, 'g'), `speckit-xref-extension-v${extension}.zip`, 1],
  ],
}

// Every pattern must match as often as expected before anything is written: a moved link fails loudly, not silently.
const out = {}
for (const [rel, list] of Object.entries(edits)) {
  let text = read(rel)
  for (const [re, to, count] of list) {
    const found = (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length
    if (found !== count) {
      console.error(`${rel}: expected ${count} × ${re.source}, found ${found}`)
      process.exit(1)
    }
    text = text.replace(re, to)
  }
  out[rel] = text
}
const changed = Object.entries(out).filter(([rel, text]) => text !== read(rel))
for (const [rel, text] of changed) writeFileSync(join(root, rel), text)
console.log(`release ${oldTag} → ${version}, extension ${oldExt} → ${extension}: ${changed.length ? changed.map(([rel]) => rel).join(', ') : 'nothing to change'}`)
