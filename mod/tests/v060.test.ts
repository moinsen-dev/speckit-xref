import { expect, test } from 'claude-code/testing'

import { acceptPrompt, acceptanceCounts, acceptanceFrom, parseAcceptanceDoc, platformsFromPlan, scenarioState } from '../hooks/accept'
import { treeOf, verifyKey } from '../hooks/brief'
import { renderDashboard } from '../hooks/dashboard'
import { emptyLedger, evaluate } from '../hooks/xref'
import { MAX_ACCEPTS, idleAutopilot, nextStep, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { fingerprint, rulesFrom } from '../hooks/rules'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.6.0: a feature people use is played through after verify, scenario by scenario, by a driver that leaves a JUnit
// report; only that report accepts a scenario, failures become fix tasks, and the person's part is listed.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const SPEC = parseSpec(DEMO[`${FEATURE}/spec.md`]!)
const AS1 = SPEC.stories[0]!.scenarios[0]!
const JUNIT = (status: 'passed' | 'failed', id = 'US1-AS1') =>
  `<testsuites><testsuite name="acceptance"><testcase name="${id} Given a registered email, when the user requests a link" classname="e2e/acceptance/${id}.spec.ts">${status === 'failed' ? '<failure>expected the email</failure>' : ''}</testcase></testsuite></testsuites>`
const DOC = `# Acceptance\n\n| Scenario | Driver | Flow | Result | Evidence |\n|---|---|---|---|---|\n| US1-AS1 | playwright | e2e/acceptance/US1-AS1.spec.ts | pass | e2e/acceptance/shots/US1-AS1.png |\n\n## Your part\n- SC-001 with five real testers: time to the first link.\n`
const PLAN = (DEMO[`${FEATURE}/plan.md`] ?? '').replace('**Testing**: vitest', '**Testing**: vitest\n**Project Type**: web-app\n**Target Platform**: modern browsers')
const DONE = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')

test('the driver\'s report accepts or fails a scenario; skipped says nothing; changed text asks again', () => {
  expect(platformsFromPlan('**Target Platform**: iOS 16+, Android 8+ (API 26), moderne Browser (Expo Web)')).toEqual({ web: true, ios: true, android: true })
  expect(platformsFromPlan('**Target Platform**: Linux server')).toEqual({ web: false, ios: false, android: false })
  const cases = [
    { name: 'US1-AS1 requests a link', classname: '', file: '', status: 'passed' as const },
    { name: 'US1-AS1 on mobile', classname: '', file: '', status: 'failed' as const },
    { name: 'US9-AS9 not in the spec', classname: '', file: '', status: 'passed' as const },
    { name: 'skipped one', classname: 'US1-AS1', file: '', status: 'skipped' as const },
  ]
  const result = acceptanceFrom(cases, SPEC, 'now', 'reports/acceptance-web.xml')
  expect(Object.keys(result)).toEqual(['US1-AS1'])
  expect(result['US1-AS1']).toEqual({ ok: false, fingerprint: fingerprint(AS1.text), at: 'now', file: 'reports/acceptance-web.xml' })
  const accepted = { ...emptyLedger(), acceptance: { 'US1-AS1': { ok: true, fingerprint: fingerprint(AS1.text), at: '', file: '' } } }
  expect(scenarioState('US1-AS1', AS1.text, accepted)).toBe('accepted')
  expect(scenarioState('US1-AS1', AS1.text + ' (changed)', accepted)).toBe('stale')
  expect(scenarioState('US1-AS1', AS1.text, { ...accepted, acceptance: { 'US1-AS1': { ...accepted.acceptance['US1-AS1']!, ok: false } } })).toBe('failing')
  expect(scenarioState('US1-AS1', AS1.text, emptyLedger())).toBe('untested')
  expect(parseAcceptanceDoc(DOC)).toEqual({ evidence: { 'US1-AS1': { shot: 'e2e/acceptance/shots/US1-AS1.png', flow: 'e2e/acceptance/US1-AS1.spec.ts' } }, yourPart: ['SC-001 with five real testers: time to the first link.'] })
  expect(acceptanceCounts({ spec: SPEC, acceptanceDoc: parseAcceptanceDoc(DOC) }, accepted)).toEqual({ total: 1, accepted: 1, failing: 0, stale: 0, yourPart: 1 })
})

test('what acceptance writes does not change what was verified; the app\'s code does', () => {
  const base = '100644 blob a1\tsrc/auth/token.ts'
  expect(treeOf(`${base}\n100644 blob f1\te2e/acceptance/US1-AS1.spec.ts\nh1 reports/acceptance-web.xml\nh2 e2e/acceptance/shots/US1-AS1.png\n100644 blob d1\tspecs/001-x/acceptance.md\n100644 blob r1\t.specify/memory/runbook.md`)).toBe(treeOf(base))
  expect(treeOf('100644 blob a2\tsrc/auth/token.ts')).not.toBe(treeOf(base))
  expect(treeOf(`${base}\nh3 src/new-file.ts`)).not.toBe(treeOf(base))
})

function doneSnap(extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(DONE)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true, npx: true, maestro: false, chrome: true }, playwright: true, folder: 'existing', spec: SPEC, tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills', rules: rulesFrom(null), realTests: [],
    planFingerprint: 'p', testCommand: null, branch: null, phase: null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: true, platforms: platformsFromPlan(PLAN), ...extra,
  } as unknown as Snapshot
}

test('after verify a feature with a user interface is accepted once for its tree; off, without a UI or once accepted, it is done', () => {
  const snap = doneSnap()
  const key = verifyKey(snap, tasksFingerprint(snap.tasks))
  const verified = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { converge: tasksFingerprint(snap.tasks), verify: key } }
  const accept = nextStep(snap, verified, null, { review: 'none' })
  expect([accept.phase, accept.approve]).toEqual(['accept', { key: 'accept', value: key }])
  expect(accept.prompt).toContain('speckit-xref:accept skill')
  expect(accept.prompt).toContain('US1-AS1 "Given a registered email')
  expect(accept.prompt).toContain('PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/acceptance-web.xml npx playwright test e2e/acceptance --reporter=junit')
  expect(accept.prompt).not.toContain('Maestro')
  expect(accept.prompt).toContain("Do not change the app's code in this step")
  expect(nextStep(snap, { ...verified, checkpoints: { ...verified.checkpoints, accept: key } }, null, { review: 'none' }).phase).toBe('done')
  expect(nextStep(snap, verified, null, { review: 'none', acceptance: false }).phase).toBe('done')
  expect(nextStep({ ...snap, ui: false } as Snapshot, verified, null, { review: 'none' }).phase).toBe('done')
  // No driver here: every scenario goes to the person, with its steps.
  expect(acceptPrompt({ ...snap, tools: { specify: true, uvx: true } } as Snapshot)).toContain('No driver is available on this machine')
  expect(acceptPrompt({ ...snap, platforms: { web: false, ios: true, android: false }, tools: { specify: true, uvx: true, maestro: true } } as Snapshot)).toContain('maestro test --format junit --output reports/acceptance-mobile.xml e2e/acceptance')
})

test('one counter for verify and acceptance: three rounds with acceptance, then Call it done', () => {
  const snap = doneSnap()
  const ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { converge: tasksFingerprint(snap.tasks) } }
  expect(nextStep(snap, ledger, null, { review: 'none', verifies: MAX_ACCEPTS - 1 }).phase).toBe('verify')
  const limit = nextStep(snap, ledger, null, { review: 'none', verifies: MAX_ACCEPTS })
  expect([limit.phase, limit.approve?.key]).toEqual(['review', 'done'])
  expect(limit.why).toBe('Verify and acceptance found new work in each of their last 3 rounds, and it is built.')
  // Without a UI the verify limit stays at two.
  expect(nextStep({ ...snap, ui: false } as Snapshot, ledger, null, { review: 'none', verifies: 2 }).approve?.key).toBe('done')
})

test('the acceptance step live: a fresh passing report accepts the scenario, the run ends done, the pane and dashboard say so', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, onPath: ['uvx', 'npx'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain(`accept: ${FEATURE} is verified: play its 1 acceptance scenarios through as a person would.`)
  seen.write('reports/acceptance-web.xml', JUNIT('passed'))
  seen.write(`${FEATURE}/acceptance.md`, DOC)
  await runTurn($, 'One scenario passed; one is your part.')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).acceptance['US1-AS1']).toMatchObject({ ok: true, fingerprint: fingerprint(AS1.text), file: 'reports/acceptance-web.xml' })
  expect(seen.toasts.at(-1)).toContain('Autopilot done:')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('Accept1/1 accepted · 1 your part')
  await xref($, 'web')
  const html = seen.files['.specify/xref/local/dashboard.html']!
  expect(html).toContain('★ 1/1 accepted')
  expect(html).toContain('<span class="rung r-accepted">★ accepted</span>')
  expect(html).toContain('<a href="#req-SC-001">SC-001</a> with five real testers: time to the first link.')
})

test('a report from before the step, or a failing one, accepts nothing', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE, 'reports/acceptance-web.xml': JUNIT('passed') }, { tests: { exits: [0] }, onPath: ['uvx', 'npx'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('accept:')
  // The step wrote no report: last round's pass stays last round's.
  await runTurn($, 'Could not start the app.')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).acceptance ?? {}).toEqual({})
})

test('a failing report fails the scenario', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, onPath: ['uvx', 'npx'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  seen.write('reports/acceptance-web.xml', JUNIT('failed'))
  await runTurn($, 'US1-AS1 failed: a fix task is appended.')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).acceptance['US1-AS1'].ok).toBe(false)
})

test('the dashboard\'s matrix gives SC rows their rung and scenarios their acceptance state', () => {
  const snap = doneSnap()
  const ledger = { ...emptyLedger(), acceptance: { 'US1-AS1': { ok: false, fingerprint: fingerprint(AS1.text), at: '2026-10-11', file: 'reports/acceptance-web.xml' } } }
  const html = renderDashboard({
    generatedAt: '', root: '/work', snap, ledger, report: evaluate(snap, ledger), levels: { 'SC-001': 'planned' }, step: { phase: 'accept', line: '', needsUser: null },
    strip: '', autopilot: idleAutopilot(), runLog: [], docs: [], refreshSeconds: 0,
  })
  expect(html).toContain('<a href="#acceptance">Acceptance</a>')
  expect(html).toContain('<span class="rung r-failing">✖ failing</span>')
  expect(html).toContain('<span class="rung r-planned">◔ planned</span>')
})

test('converge rates its gaps like verify: only HIGH and MEDIUM become tasks', () => {
  const tasks = parseTasks(DONE)
  const snap = { ...doneSnap(), commands: ['converge'] } as Snapshot
  const converge = nextStep(snap, { ...emptyLedger(), approvals: { spec: 'x' } }, null, { review: 'none' })
  expect(converge.phase).toBe('converge')
  expect(converge.approve).toEqual({ key: 'converge', value: tasksFingerprint(tasks) })
  expect(converge.prompt).toBe("Run /speckit-converge now through the Skill tool and carry it through. Append tasks only for its HIGH and MEDIUM gaps; list the LOW ones in your answer under 'Low, no task'.")
})

test('the web driver never downloads: Chrome and the project\'s Playwright decide between playing, a setup task and the person\'s part', () => {
  const base = doneSnap()
  const ready = acceptPrompt({ ...base, tools: { ...base.tools, npx: true, chrome: true }, playwright: true } as Snapshot)
  expect(ready).toContain("installed Google Chrome (`channel: 'chrome'`; never download a browser)")
  expect(ready).toContain('PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/acceptance-web.xml')
  const setup = acceptPrompt({ ...base, tools: { ...base.tools, npx: true, chrome: true }, playwright: false } as Snapshot)
  expect(setup).toContain("Playwright is not set up in this project yet, so play nothing on the web in this step. Append one task under '## Phase N: Acceptance setup'")
  expect(setup).toContain("`channel: 'chrome'` (the installed Google Chrome; no browser download)")
  expect(setup).not.toContain('PLAYWRIGHT_JUNIT_OUTPUT_NAME')
  const none = acceptPrompt({ ...base, tools: { ...base.tools, npx: true, chrome: false }, playwright: true } as Snapshot)
  expect(none).toContain('no Google Chrome is installed here, and this step never downloads a browser')
  for (const prompt of [ready, setup, none]) expect(prompt).not.toContain('playwright install')
})
