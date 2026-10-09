// Holds the extension's Python readers to the mod's TypeScript ones: both parse the same files, the results must be equal.
// Run: node --experimental-strip-types scripts/parity.mjs [more spec/tasks/constitution files...]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const { parseSpec, parseTasks, parseConstitution } = await import('../mod/hooks/speckit.ts')
const root = new URL('..', import.meta.url).pathname
const py = `${root}extension/scripts/python/xref.py`
const demo = `${root}examples/demo`
const files = [
  ['spec', `${demo}/specs/001-magic-link-login/spec.md`],
  ['tasks', `${demo}/specs/001-magic-link-login/tasks.md`],
  ['constitution', `${demo}/.specify/memory/constitution.md`],
  ['spec', `${root}scripts/fixtures/edge-spec.md`],
  ['tasks', `${root}scripts/fixtures/edge-tasks.md`],
  ...process.argv.slice(2).map(f => [/tasks/.test(f) ? 'tasks' : /constitution/.test(f) ? 'constitution' : 'spec', f]),
]
const ts = { spec: parseSpec, tasks: parseTasks, constitution: parseConstitution }
let failed = 0
for (const [kind, file] of files) {
  const mine = ts[kind](readFileSync(file, 'utf8'))
  const theirs = JSON.parse(execFileSync('python3', ['-I', py, 'dump', `--${kind}`, file], { encoding: 'utf8' }))[kind]
  const same = isDeepStrictEqual(mine, theirs)
  if (!same) failed += 1
  console.log(`${same ? 'same' : 'DIFF'}  ${kind.padEnd(12)} ${file.replace(root, '')}`)
  if (!same) console.log('  ts:', JSON.stringify(mine).slice(0, 2000), '\n  py:', JSON.stringify(theirs).slice(0, 2000))
}
process.exit(failed ? 1 : 0)
