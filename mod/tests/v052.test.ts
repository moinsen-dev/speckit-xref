import { expect, test } from 'claude-code/testing'

import { parsePhaseNotes, parseQuickstart, phaseBrief, runbookNote, treeOf, verifyKey } from '../hooks/brief'
import { pushAllowed, railFor } from '../hooks/register'
import { anchorsIn, applySemantic, echoesDecision, emptyLedger, forkPrompt } from '../hooks/xref'
import { AUTONOMY_RULES, nextStep, phaseStrip, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom } from '../hooks/rules'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { BAND, FEATURE, PANE, ROOT, ledgerOf, project, runTurn, startSession, toText, type, xref } from './harness'

// 0.5.2: the autopilot goes on after "done" (a new feature, a change, a bug), hands each phase its own brief, and the
// person's yes in the ask dialog opens exactly the action the rails stopped.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const TASKS = DEMO[`${FEATURE}/tasks.md`]!.replace(
  '## Phase 3: User Story 1 - Request a login link (Priority: P1) 🎯 MVP\n',
  '## Phase 3: User Story 1 - Request a login link (Priority: P1) 🎯 MVP\n\n**Goal**: A user gets a link by email\n\n**Independent Test**: Request a link for a registered email; the\n  email arrives with one link (quickstart Q1)\n\n',
).replace('- [ ] T005 [US1] Implement POST /auth/link handler in src/auth/request-link.ts (FR-001)\n', '- [ ] T005 [US1] Implement POST /auth/link handler in src/auth/request-link.ts (FR-001)\n\n**Checkpoint**: US1 works on its own\n')
const QUICKSTART = '# Quickstart\n\n| # | Step | Expect | Proof |\n|---|---|---|---|\n| Q1 | Request a link | email with one link | US1-AS1, FR-001 |\n| Q2 | Open it twice | second is rejected | US2, FR-004 |\n'
const RUNBOOK = '- The mail sandbox listens on port 1025, not 25.\n'
const DONE = TASKS.replace(/- \[ \]/g, '- [x]')

test('tasks.md\'s phase notes, quickstart\'s rows and the brief they make', () => {
  const notes = parsePhaseNotes(TASKS)
  const phase = 'Phase 3: User Story 1 - Request a login link (Priority: P1) 🎯 MVP'
  expect(notes[phase]).toEqual({ goal: 'A user gets a link by email', test: 'Request a link for a registered email; the email arrives with one link (quickstart Q1)', checkpoint: 'US1 works on its own' })
  expect(parseQuickstart(QUICKSTART)).toEqual([
    { ids: ['US1-AS1', 'FR-001'], text: 'Q1 · Request a link · email with one link · US1-AS1, FR-001' },
    { ids: ['US2', 'FR-004'], text: 'Q2 · Open it twice · second is rejected · US2, FR-004' },
  ])
  const snap = { featureDir: FEATURE, spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks: parseTasks(TASKS), phaseNotes: notes, quickstart: parseQuickstart(QUICKSTART), design: null } as unknown as Snapshot
  const brief = phaseBrief(snap, phase, { ok: true, at: '', output: '' })
  expect(brief[0]).toBe('Phase brief (tasks.md, spec.md, quickstart.md):')
  expect(brief).toContain('- Goal: A user gets a link by email')
  expect(brief.find(l => l.startsWith('- Prove: US1-AS1 "Given a registered email'))).toContain('Name each test after the scenario it proves')
  expect(brief).toContain('- Quickstart: Q1 · Request a link · email with one link · US1-AS1, FR-001')
  expect(brief).toContain('- Last test run: green.')
  expect(brief.at(-1)).toBe('- Done when: US1 works on its own. Check that before you end the step, and say how you checked it.')
  expect(runbookNote(RUNBOOK)).toContain('port 1025')
  expect(runbookNote('  ')).toBe(null)
  // The ledger's own file is no change of the tree.
  expect(treeOf(' M src/a.ts\n M specs/001-x/xref.json\n')).toBe(treeOf(' M src/a.ts\n'))
  expect(treeOf(' M src/a.ts\n')).not.toBe(treeOf(''))
})

test('an implement step hands over its phase brief and the runbook; the rules ask for runbook lines and xref.json in commits', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: TASKS, [`${FEATURE}/quickstart.md`]: QUICKSTART, '.specify/memory/runbook.md': RUNBOOK })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const first = autopilotPrompts(seen)[0]!
  expect(first).toContain('implement:')
  expect(first).toContain('- Independent test: Request a link for a registered email')
  expect(first).toContain('- Done when: US1 works on its own.')
  expect(first).toContain('Note: Runbook (.specify/memory/runbook.md, what earlier steps learned')
  expect(first).toContain('port 1025')
  expect(AUTONOMY_RULES.join('\n')).toContain('add one line on it to .specify/memory/runbook.md')
  expect(AUTONOMY_RULES.join('\n')).toContain("commit the feature's xref.json with it")
})

test('done holds while spec, tasks and tree stay: no second verify, but the question what comes next', () => {
  const tasks = parseTasks(DONE)
  const snap = {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills', rules: rulesFrom(null), realTests: [],
    planFingerprint: 'p', testCommand: null, branch: null, phase: null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge', 'specify'],
    checklists: [], persistence: 'flow-back', head: 'abc', tree: treeOf(''),
  } as unknown as Snapshot
  const converged = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { converge: tasksFingerprint(tasks) } }
  const flow = { review: 'none' as const }
  const verify = nextStep(snap, converged, null, flow)
  expect(verify.phase).toBe('verify')
  expect(verify.approve).toEqual({ key: 'verify', value: verifyKey(snap, tasksFingerprint(tasks)) })
  const verified = { ...converged, checkpoints: { ...converged.checkpoints, verify: verify.approve!.value } }
  const done = nextStep(snap, verified, null, flow)
  expect(done.phase).toBe('done')
  expect(done.needsUser).toContain('Say what comes next (a new feature, a change to this one, or a bug)')
  expect(phaseStrip(snap, done)).toBe('✓setup ✓const ✓spec ✓plan ✓tasks ✓impl ✓verify')
  // A new commit or an uncommitted change asks for a verification again.
  expect(nextStep({ ...snap, head: 'def' } as Snapshot, verified, null, flow).phase).toBe('verify')
  expect(nextStep({ ...snap, tree: treeOf(' M src/auth/token.ts') } as Snapshot, verified, null, flow).phase).toBe('verify')
  // What comes next, by kind.
  const feature = nextStep(snap, verified, null, { ...flow, next: { kind: 'feature', text: 'Passkeys as a second way in' } })
  expect([feature.phase, feature.command, feature.consumes]).toEqual(['specify', '/speckit-specify Passkeys as a second way in', true])
  const change = nextStep(snap, verified, null, { ...flow, next: { kind: 'change', text: 'Links last 30 minutes' } })
  expect(change.phase).toBe('revise')
  expect(change.prompt).toContain('"Links last 30 minutes". Fold it into spec.md first')
  const bug = nextStep(snap, verified, null, { ...flow, next: { kind: 'bug', text: 'The link opens a blank page on Safari' } })
  expect(bug.phase).toBe('bug')
  expect(bug.prompt).toContain('write a test that fails because of the bug')
  expect(bug.prompt).toContain("under '## Phase N: Fixes'")
  expect(nextStep(snap, verified, null, { ...flow, nextKind: 'bug' }).needsUser).toContain('Describe the bug')
})

test('a finished feature: the run ends verified, and the next start asks what comes next; Bug and the words go on', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot done:')
  expect(autopilotPrompts(seen)).toHaveLength(2)
  // Started again on the same tree: no verify, the question.
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: The feature is done. Say what comes next')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('[New feature] [Change] [Bug]')
  await pane.press({ key: 'next-bug' })
  expect(seen.toasts.at(-1)).toContain('Describe the bug: what you did, what happened, what you expected')
  await type($, 'The link opens a blank page on Safari')
  const note = seen.submitted.at(-1).context.join('\n')
  expect(note).toContain('takes these words as a bug to reproduce and fix')
  expect(seen.classified).toHaveLength(0)
  await runTurn($, 'Noted.')
  await seen.clock.advance(0)
  const bug = autopilotPrompts(seen).at(-1)!
  expect(bug).toContain('bug: A bug in specs/001-magic-link-login: "The link opens a blank page on Safari".')
  // Handed over once: the next step does not take the same words again.
  expect(ledgerOf(seen.files).checkpoints.verify).toHaveLength(64)
})

test('/xref next feature <words> specifies the next feature in the person\'s words; typed words are told apart by a small model', { options: { review: 'none' } }, async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, classify: 'a new feature, separate from the finished one' })
  await startSession($)
  expect((await xref($, 'next feature Passkeys')).text).toBe('The feature is not done yet: the autopilot finishes it first (/xref auto on).')
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect((await xref($, 'next feature Passkeys as a second way in')).text).toBe('Next: a new feature: "Passkeys as a second way in". The autopilot takes it from here.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('Run /speckit-specify Passkeys as a second way in now')
  expect(seen.classified).toHaveLength(0)
})

test('at a done feature a question stays a question; words that name new work start it', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, classify: 'no new work: a question or a remark' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await type($, 'Wie ist der Stand?')
  expect(seen.classified.at(-1)).toBe('Wie ist der Stand?')
  expect((seen.submitted.at(-1).context ?? []).join('\n')).not.toContain('takes these words as')
  expect((await xref($, 'next Wie ist der Stand?')).text).toBe('That reads as a question, not new work: /xref next feature|change|bug <words> names the kind.')
})

test('the ask dialog opens the stopped action once: yes allows one push, the second is stopped again; no keeps it stopped', async ($, on) => {
  project(on, { ...DEMO }, { answers: ['Yes, allow pushing once', 'No'] })
  await startSession($)
  await xref($, 'auto on')
  const push = { tool: 'Bash', input: { command: 'git push origin 001-magic-link-login' } }
  const denied = await $.tool.check(push as never)
  expect(denied.decision).toBe('deny')
  expect(denied.reason).toContain('passing allow: "pushing"; their yes allows it once')
  const yes = await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Push the branch?', allow: 'pushing' } as never)
  expect(yes.result).toBe('The person allowed pushing once: run it now.')
  expect((await $.tool.check(push as never)).decision).not.toBe('deny')
  expect((await $.tool.check(push as never)).decision).toBe('deny')
  const no = await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Push the branch?', allow: 'pushing' } as never)
  expect(no.result).toBe('The person said no: leave pushing to them, and say so in your answer.')
  expect((await $.tool.check(push as never)).decision).toBe('deny')
})

test('allowPush: a plain push of a feature branch after green tests; never main, never forced, never a deletion', () => {
  expect(pushAllowed('git push origin 002-passkeys', '002-passkeys', true)).toBe(true)
  expect(pushAllowed('git push', '002-passkeys', true)).toBe(true)
  expect(pushAllowed('git push', 'main', true)).toBe(false)
  expect(pushAllowed('git push origin main', '002-passkeys', true)).toBe(false)
  expect(pushAllowed('git push --force', '002-passkeys', true)).toBe(false)
  expect(pushAllowed('git push -f origin 002-passkeys', '002-passkeys', true)).toBe(false)
  expect(pushAllowed('git push origin :old-branch', '002-passkeys', true)).toBe(false)
  expect(pushAllowed('git push', '002-passkeys', false)).toBe(false)
  expect(railFor('Bash', { command: 'git push' })).toBe("pushing is the person's call")
})

test('allowPush: on lets the autopilot push a feature branch by itself', { options: { allowPush: 'on' } }, async ($, on) => {
  project(on, { ...DEMO }, { branch: '001-magic-link-login' })
  await startSession($)
  await xref($, 'auto on')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push -u origin 001-magic-link-login' } } as never)).decision).not.toBe('deny')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push --force' } } as never)).decision).toBe('deny')
})

test('a -p run: the person\'s first prompt is the first step, handed over with its prompt and logged', { options: { autopilot: 'on' } }, async ($, on) => {
  const seen = project(on, { ...DEMO })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  await type($, 'Go on with the next step.')
  const context = seen.submitted.at(-1).context.join('\n')
  expect(context).toContain('[speckit-xref autopilot · step 1/25] implement')
  const second = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'T004 done.' } as never)
  expect(second.block).toContain('step 2/25')
  const log = seen.files[`.specify/xref/local/001-magic-link-login.run.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(log.map(e => [e.step, e.phase])).toEqual([[1, 'implement']])
  // The band still answers.
  expect(toText(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).drawn())).toContain('auto')
})

test('an answered decision is no request: a check that reports a push or a wipe as new scope is overruled', () => {
  const decisions = [
    { id: 'D1', question: 'Auf deinem Android-Emulator Pixel_10 ist kein Platz für Expo Go. Darf ich ihn per „Wipe Data“ zurücksetzen und testen?', options: [], blocks: [], at: '', answer: 'Ja' },
    { id: 'D2', question: 'Soll ich ihn zu moinsen-dev/tagesinspiration pushen?', options: [], blocks: [], at: '', answer: 'Ja, pushen', kind: 'permission' as const },
  ]
  expect(echoesDecision('Pixel_10 per „Wipe Data“ zurücksetzen und testen', decisions)).toBe(true)
  expect(echoesDecision('Code nach moinsen-dev/tagesinspiration pushen', decisions)).toBe(true)
  expect(echoesDecision('Links auch per SMS verschicken', decisions)).toBe(false)
  const ledger = { ...emptyLedger(), decisions }
  const applied = applySemantic(ledger, { at: '', head: '', diffHash: '', score: 90, verdict: 'aligned', reasons: [], changes: [{ text: 'Pixel_10 per „Wipe Data“ zurücksetzen und testen', kind: 'extends' }, { text: 'Links auch per SMS verschicken', kind: 'extends' }] } as never)
  expect(applied.semantic!.changes.map(c => c.text)).toEqual(['Links auch per SMS verschicken'])
  // A permission never reaches the check as a decision.
  const prompt = forkPrompt({ featureDir: FEATURE, spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks: parseTasks(DEMO[`${FEATURE}/tasks.md`]!), constitution: null } as unknown as Snapshot, ledger, null, [], '')
  expect(prompt).toContain('Pixel_10')
  expect(prompt).not.toContain('pushen')
})

test('an anchor names every id after @spec; a feature prefix carries to the bare ids', () => {
  expect(anchorsIn('// @spec 001-tagesinspiration/FR-003 FR-004\n# @spec FR-001, US1-AS2 and more\nx @spec 001-a/FR-001 002-b/FR-002 FR-003', 'f.ts').map(a => `${a.id}@${a.line}`)).toEqual([
    '001-tagesinspiration/FR-003@1',
    '001-tagesinspiration/FR-004@1',
    'FR-001@2',
    'US1-AS2@2',
    '001-a/FR-001@3',
    '002-b/FR-002@3',
    '002-b/FR-003@3',
  ])
  expect(anchorsIn('// @spec: see below', 'f.ts')).toEqual([])
})
