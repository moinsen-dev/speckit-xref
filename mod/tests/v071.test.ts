import { expect, test } from 'claude-code/testing'

import { treeOf, verifyKey } from '../hooks/brief'
import { parseJunit } from '../hooks/proof'
import { emptyLedger } from '../hooks/xref'
import { nextStep, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom } from '../hooks/rules'
import { RELEASE } from '../hooks/ship'
import { acceptPrompt } from '../hooks/accept'
import type { Ledger, Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.7.1: the person's Ship holds through the readiness rounds and across sessions; Vitest's reports reach the anchors.

const DONE = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
const RELEASE_MD = `# Release\n\n**Version**: 1.0.0\n**Targets**: web\n**Ready**: yes\n\n## Release commands\n\n1. \`npx wrangler pages deploy dist --project-name magic-link\`\n\n## Releases\n\n| Date | Version | Target | Result | Where |\n|---|---|---|---|---|\n`

function doneSnap(extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(DONE)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills', rules: rulesFrom(null), realTests: [],
    planFingerprint: 'p', testCommand: null, branch: null, phase: null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: false, ...extra,
  } as unknown as Snapshot
}

test('the person\'s Ship holds without a word in the session: through a readiness round, until other work or the release', () => {
  const snap = doneSnap()
  const key = verifyKey(snap, tasksFingerprint(snap.tasks))
  const done: Ledger = { ...emptyLedger(), checkpoints: { converge: tasksFingerprint(snap.tasks), verify: key } }
  expect(nextStep(snap, done, null, { review: 'none' }).phase).toBe('done')
  const wanted: Ledger = { ...done, checkpoints: { ...done.checkpoints, shipWanted: 'yes' } }
  expect(nextStep(snap, wanted, null, { review: 'none' }).phase).toBe('ship')
  // A readiness round changed the tree: the check of the old tree is stale, the wish is not.
  const after = doneSnap({ tree: treeOf('b') })
  const reverified: Ledger = { ...wanted, checkpoints: { ...wanted.checkpoints, ship: key, verify: verifyKey(after, tasksFingerprint(after.tasks)) } }
  const again = nextStep(after, reverified, null, { review: 'none' })
  expect([again.phase, again.approve?.key]).toEqual(['ship', 'ship'])
  // Other work the person names comes first.
  expect(nextStep(snap, wanted, null, { review: 'none', next: { kind: 'change', text: 'Longer links' } }).phase).toBe('revise')
})

test('Ship writes the wish to the local ledger; the release step carries it out; Not now and other work drop it', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'ship')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBe('yes')
  seen.write(RELEASE, RELEASE_MD)
  await runTurn($, 'Written.')
  await seen.clock.advance(0)
  await xref($, 'approve')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBeUndefined()
  // A new wish, then Not now.
  seen.write(RELEASE, RELEASE_MD + '| 2026-10-11 | 1.0.0 | web | shipped | https://magic-link.pages.dev |\n')
  await runTurn($, 'Released.')
  await seen.clock.advance(0)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await xref($, 'ship')
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBe('yes')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await seen.clock.advance(0)
  await runTurn($, 'Checked.')
  await seen.clock.advance(0)
  await pane.press({ key: 'ship-later' })
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBeUndefined()
  // Another wish, then a new feature instead.
  await xref($, 'ship')
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBe('yes')
  await seen.clock.advance(0)
  await runTurn($, 'Checked.')
  await seen.clock.advance(0)
  await xref($, 'next feature Passkeys')
  expect(ledgerOf(seen.files).checkpoints.shipWanted).toBeUndefined()
})

test('Vitest writes no file attribute: the path in classname is the test file, so its anchors count', () => {
  const xml = '<testsuites name="vitest tests"><testsuite name="tests/auth/token.test.ts"><testcase classname="tests/auth/token.test.ts" name="issues a single-use token" time="0.01"/></testsuite></testsuites>'
  expect(parseJunit(xml)).toEqual([{ name: 'issues a single-use token', classname: 'tests/auth/token.test.ts', file: 'tests/auth/token.test.ts', status: 'passed' }])
  expect(parseJunit('<testcase classname="auth.token" name="x"/>')[0]!.file).toBe('')
  expect(parseJunit('<testcase classname="e2e/acceptance/US1-AS1.spec.ts" name="US1-AS1 …"/>')[0]!.file).toBe('e2e/acceptance/US1-AS1.spec.ts')
})

test('found live: while the check still runs, the pane offers no Ship it; after it, Not now asks again what comes next', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE, [RELEASE]: RELEASE_MD }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'ship')
  await seen.clock.advance(0)
  // The check is handed over and runs; an earlier release.md is already there.
  const turnId = 'running-check'
  await $.turn.start({ text: seen.submitted.at(-1)!.text, turnId })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const during = toText(await pane.drawn())
  expect(during).toContain('Claude is still on this step: it opens here when the step ends.')
  expect(during).not.toContain('[Ship it]')
  await $.turn.complete({ reason: 'answer', answer: 'Checked.', durationMs: 1000, isAborted: false, turnId })
  await seen.clock.advance(0)
  expect(toText(await pane.drawn())).toContain('[Ship it] [Check again] [Not now]')
  await pane.press({ key: 'ship-later' })
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: The feature is done.')
})

test('found live: mobile acceptance plays on Expo Go when no development build is installed, and never builds one in the step', () => {
  const prompt = acceptPrompt(doneSnap({ platforms: { web: false, ios: false, android: true }, tools: { specify: true, uvx: true, maestro: true } } as Partial<Snapshot>))
  expect(prompt).toContain('a development build of the app if one is installed, else Expo Go')
  expect(prompt).toContain("downloads native dependencies: that is no part of this step, but a task under '## Phase N: Acceptance setup'")
})

test('found live: a failing run reaches the repair step without the runner\'s colour codes', { options: { tests: 'lean', orchestrate: 'off' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [1], output: '\u001b[31mFAIL\u001b[39m tests/flows/moment.test.tsx\n  \u001b[1m● FR-019 shows new ideas\u001b[22m' } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  const repair = seen.submitted.map(e => e.text as string).filter(t => t.includes('] repair:')).at(-1) ?? ''
  expect(repair).toContain('FAIL tests/flows/moment.test.tsx')
  expect(repair).not.toContain('\u001b[')
})

test('found live: a flow that taps by screen coordinates accepts nothing, and the person hears why', { options: { acceptance: 'auto', userTest: 'off' } }, async ($, on) => {
  const PLAN = (DEMO[`${FEATURE}/plan.md`] ?? '').replace('**Testing**: vitest', '**Testing**: vitest\n**Project Type**: web-app\n**Target Platform**: modern browsers')
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, onPath: ['uvx', 'npx'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  const report = (file: string) => `<testsuites><testsuite name="m"><testcase name="US1-AS1 requests a link" classname="US1-AS1 requests a link" file="${file}" status="SUCCESS"/></testsuite></testsuites>`
  seen.write('e2e/acceptance/US1-AS1.yaml', "appId: host.exp.exponent\nname: \"US1-AS1 requests a link\"\n---\n- tapOn:\n    point: '90%,45%'\n")
  seen.write('reports/acceptance-mobile.xml', report('e2e/acceptance/US1-AS1.yaml'))
  await runTurn($, 'Played on mobile.')
  await seen.clock.advance(0)
  expect(seen.toasts).toContain('Not accepted, the flow taps by screen coordinates: e2e/acceptance/US1-AS1.yaml.')
  expect(ledgerOf(seen.files).acceptance?.['US1-AS1']).toBeUndefined()
})
