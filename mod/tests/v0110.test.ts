import { expect, test } from 'claude-code/testing'

import { LEAN_TESTS, NO_TESTS, RUN_TESTS, testRule, treeOf } from '../hooks/brief'
import { branchName, branches, checkCommandFor, ciNote, gateWords, prBody, testsNote, touchesCi } from '../hooks/gitci'
import { IMPLEMENTER } from '../hooks/orchestrate'
import { emptyLedger } from '../hooks/xref'
import { nextStep, tasksFingerprint, verifyRule } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom, specFingerprint } from '../hooks/rules'
import type { Ledger, Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, ledgerOf, project, runTurn, startSession, xref } from './harness'

// 0.11.0: tests, CI/CD and git are the person's to switch on. By default a project runs without a test suite (the type
// check of its language is the gate), the autopilot writes no CI/CD pipeline, and every feature lands on the branch the
// person is on; a branch per feature, or a pull request when done, only when they set it.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const SPEC = parseSpec(DEMO[`${FEATURE}/spec.md`]!)
const TSCONFIG = { 'tsconfig.json': '{}', 'node_modules/typescript/package.json': '{}' }
const run = 'npm run'

function snapOf(extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(DEMO[`${FEATURE}/tasks.md`]!)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: SPEC, tasks, constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
    commandStyle: 'skills', rules: rulesFrom(null), realTests: [], planFingerprint: 'p', testCommand: 'npx --no-install tsc --noEmit', branch: null,
    phase: tasks.find(t => !t.done)?.phase ?? null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge', 'analyze'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: false, gate: 'check', testMode: 'off', ciOn: false, ...extra,
  } as unknown as Snapshot
}

test("the type check of the project's language: its own script first, then the language's usual one", () => {
  expect(checkCommandFor({ packageJson: '{"scripts":{"typecheck":"tsc --noEmit"}}', typescript: true, pubspec: null, cargo: false, goMod: false, swiftPackage: false, mypy: false, run })).toBe('npm run typecheck')
  expect(checkCommandFor({ packageJson: '{"scripts":{"test":"jest"}}', typescript: true, pubspec: null, cargo: false, goMod: false, swiftPackage: false, mypy: false, run })).toBe('npx --no-install tsc --noEmit')
  // TypeScript named but not installed: no command that would download it.
  expect(checkCommandFor({ packageJson: '{}', typescript: false, pubspec: null, cargo: false, goMod: false, swiftPackage: false, mypy: false, run })).toBeNull()
  expect(checkCommandFor({ packageJson: null, typescript: false, pubspec: 'dependencies:\n  flutter:\n    sdk: flutter\n', cargo: false, goMod: false, swiftPackage: false, mypy: false, run })).toBe('flutter analyze --no-fatal-infos')
  expect(checkCommandFor({ packageJson: null, typescript: false, pubspec: 'name: tool\n', cargo: false, goMod: false, swiftPackage: false, mypy: false, run })).toBe('dart analyze')
  expect(checkCommandFor({ packageJson: null, typescript: false, pubspec: null, cargo: true, goMod: false, swiftPackage: false, mypy: false, run })).toBe('cargo check')
  expect(checkCommandFor({ packageJson: null, typescript: false, pubspec: null, cargo: false, goMod: true, swiftPackage: false, mypy: false, run })).toBe('go vet ./...')
})

test('tests off: no test tasks, no tests written, a missing test is no finding, and the gate is the type check', () => {
  expect(testRule('off')).toBe(NO_TESTS)
  expect(testRule('run')).toBe(RUN_TESTS)
  expect(testRule('lean')).toBe(LEAN_TESTS)
  expect(testRule(undefined)).toBe(LEAN_TESTS)
  expect(testsNote('off')).toContain('Write no test tasks and no tests')
  expect(verifyRule({ testMode: 'off' })).not.toContain('no test proves it')
  expect(verifyRule({ testMode: 'lean' })).toContain('no test proves it')
  const snap = snapOf()
  const ledger: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: specFingerprint(SPEC) }, requirements: { 'FR-001': { tasks: ['T001'], files: [], sources: [] } } }
  const step = nextStep(snap, ledger, null, { review: 'none', orchestrate: true })
  expect(step.phase).toBe('implement')
  expect(step.delegate?.agent).toBe(IMPLEMENTER)
  expect(step.delegate?.brief).toContain(NO_TESTS)
  expect(step.delegate?.brief).toContain('Type check: `npx --no-install tsc --noEmit` (this project runs without a test suite).')
  expect(step.notes.join('\n')).toContain('Plan and write no CI/CD pipeline')
  const repair = nextStep(snap, ledger, null, { review: 'none', lastTest: { ok: false, at: '', output: "error TS2322: Type 'string' is not assignable" }, repairs: 1 })
  expect(repair.why).toContain('The type check fails')
  expect(repair.prompt).not.toContain('not the tests')
  expect(gateWords(snap).label).toBe('Check')
  // Lean, as before 0.11.0.
  expect(nextStep(snapOf({ testMode: 'lean', gate: 'tests', ciOn: true }), ledger, null, { review: 'none', orchestrate: true }).delegate?.brief).toContain(LEAN_TESTS)
  expect(ciNote(true)).toBeNull()
})

test('CI/CD and branches the person did not ask for are recognised', () => {
  expect(touchesCi('Write', { file_path: '/work/.github/workflows/ci.yml' }, '/work')).toBe(true)
  expect(touchesCi('Edit', { file_path: '/work/.gitlab-ci.yml' }, '/work')).toBe(true)
  expect(touchesCi('Bash', { command: 'mkdir -p .github/workflows && cat > .github/workflows/test.yml <<EOF' })).toBe(true)
  expect(touchesCi('Bash', { command: 'cat .github/workflows/ci.yml' })).toBe(false)
  expect(touchesCi('Write', { file_path: '/work/src/app.ts' }, '/work')).toBe(false)
  expect(branches('Bash', { command: 'git switch -c 002-history' })).toBe(true)
  expect(branches('Bash', { command: 'git checkout -b feature/x' })).toBe(true)
  expect(branches('Bash', { command: 'git branch 002-history' })).toBe(true)
  expect(branches('Bash', { command: 'git checkout -- src/app.ts' })).toBe(false)
  expect(branches('Bash', { command: 'git branch --show-current' })).toBe(false)
  expect(branchName(FEATURE)).toBe('001-magic-link-login')
})

test("live, the defaults: the type check gates the steps, a pipeline and a branch of the autopilot's own are refused in its steps, allowed in the person's", async ($, on) => {
  const seen = project(on, { ...DEMO, ...TSCONFIG }, { tests: { exits: [1, 0] }, output: undefined } as never)
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.testRuns).toHaveLength(0)
  const status = await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)
  expect(String(status.result)).toContain('Tests: none by option (tests: off); type check: npx --no-install tsc --noEmit')
  // In the autopilot's own step.
  await $.turn.start({ text: autopilotPrompts(seen).at(-1)!, turnId: 'a1' })
  expect((await $.tool.check({ tool: 'Write', input: { file_path: '/work/.github/workflows/ci.yml', content: 'on: push' } } as never)).decision).toBe('deny')
  const branched = await $.tool.check({ tool: 'Bash', input: { command: 'git switch -c side-branch' } } as never)
  expect(branched.decision).toBe('deny')
  expect(branched.reason).toContain('option git is current')
  await runTurn($, 'T004 done.', 'answer')
  await seen.clock.advance(0)
  // The gate ran the type check; it failed, so the next step repairs it.
  expect(seen.testRuns[0]).toBe('npx --no-install tsc --noEmit')
  expect(autopilotPrompts(seen).at(-1)).toContain('] repair: The type check fails')
})

test('git branch: once the spec is written the feature gets its own branch from the one the person was on', { options: { git: 'branch' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { commits: true, branch: 'develop', commands: argv => (argv[0] === 'git' && argv[1] === 'switch' ? { stdout: '' } : undefined) })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.ran.some(a => a.join(' ') === 'git switch 001-magic-link-login' || a.join(' ') === 'git switch -c 001-magic-link-login')).toBe(true)
  expect(ledgerOf(seen.files).checkpoints).toMatchObject({ branch: '001-magic-link-login', baseBranch: 'develop' })
})

test('git pr: a done feature is committed, pushed and opened as a pull request against the branch it started from', { options: { git: 'pr' } }, async ($, on) => {
  const prArgs: string[][] = []
  const seen = project(on, { ...DEMO, ...TSCONFIG, [`${FEATURE}/tasks.md`]: DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]') }, {
    tests: { exits: [0] },
    commits: true,
    branch: '001-magic-link-login',
    onPath: ['uvx', 'gh'],
    commands: argv => {
      if (argv[0] === 'git' && argv[1] === 'status') return { stdout: ' M src/auth/token.ts\n' }
      if (argv[0] === 'git' && argv[1] === 'push') return { stdout: '' }
      if (argv[0] === 'gh') {
        prArgs.push(argv)
        return { stdout: 'https://github.com/acme/app/pull/7\n' }
      }
      return undefined
    },
  })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 4 && !seen.toasts.some(t => t.startsWith('Autopilot done:')); i++) {
    await runTurn($)
    await seen.clock.advance(0)
  }
  const done = seen.toasts.find(t => t.startsWith('Autopilot done:'))!
  expect(done).toContain('the type check passes')
  expect(done).toContain('Pull request: https://github.com/acme/app/pull/7.')
  expect(seen.ran.some(a => a[0] === 'git' && a[1] === 'commit')).toBe(true)
  expect(seen.ran.some(a => a.join(' ') === 'git push -u origin 001-magic-link-login')).toBe(true)
  expect(prArgs[0]).toContain('--title')
  expect(ledgerOf(seen.files).checkpoints.pr).toBe('https://github.com/acme/app/pull/7')
})

test('the pull request says what the feature is and how it was checked', () => {
  const body = prBody(snapOf(), { ...emptyLedger(), checkpoints: { verify: 'v', try: 't' } })
  expect(body).toContain(`Spec: \`${FEATURE}/spec.md\``)
  expect(body).toContain('verified against the spec · tried as a person would (user test) · type check green')
  expect(body).toContain('Merging is yours.')
})
