import { expect, test } from 'claude-code/testing'

import { parseSteer } from '../hooks/deputy'
import { writesCode } from '../hooks/orchestrate'
import { levelOf } from '../hooks/proof'
import { parseTasks } from '../hooks/speckit'
import { emptyLedger } from '../hooks/xref'
import { DEMO } from './fixtures/demo'
import { FEATURE, ROOT, project, runTurn, startSession, type, xref } from './harness'

// 0.12.0: listening. The person's words in the middle of a run come before its plan: the step the autopilot handed over
// does not hold their turn, and the deputy weighs their words against the plan (go on, a step it writes itself, or
// wait). A task the person put off is decided, not open; Claude may pause the run at the person's word.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const WRITE = { tool: 'Write', input: { file_path: '/work/src/auth/close.ts', content: 'x' } }

test('a task the person put off is decided, not open, and proves nothing', () => {
  const tasks = parseTasks('## Phase 1: Setup\n\n- [x] T001 Set up in `src/`\n- [~] T002 Measure the quota (FR-002)\n- [ ] T003 Retry (verschoben auf Feature 2) (FR-003)\n- [-] T004 Cache (FR-004)\n- [ ] T005 Log in `src/log.ts` (FR-005)\n')
  expect(tasks.map(t => [t.id, t.done, t.deferred ?? false])).toEqual([['T001', true, false], ['T002', true, true], ['T003', true, true], ['T004', true, true], ['T005', false, false]])
  const ledger = { ...emptyLedger(), anchors: [{ id: 'FR-002', file: 'src/quota.ts', line: 1 }], requirements: { 'FR-002': { tasks: ['T002'], files: [], sources: [] } } }
  expect(levelOf('FR-002', { featureDir: FEATURE, tasks, reqs: [{ id: 'FR-002', text: 'x' }], realTests: [] }, ledger as never)).toBe('planned')
})

test("found live: a Python script that edits only spec files is no code write; a heredoc's body is not the shell's redirect", () => {
  const py = "python3 - <<'EOF'\np='specs/001/spec.md'\ns=open(p).read()\nif len(s) > 0: s = s.replace('->', '=>')\nopen(p,'w').write(s)\nEOF"
  expect(writesCode('Bash', { command: py })).toBe(false)
  expect(writesCode('Bash', { command: "cat > src/a.ts <<'EOF'\nconst x = a > b\nEOF" })).toBe(true)
  expect(writesCode('Bash', { command: "cat > specs/001/tasks.md <<'EOF'\n- [~] T046 -> Feature 2\nEOF" })).toBe(false)
})

test('steering is read strictly: a step of its own needs its prompt', () => {
  expect(parseSteer('{"action":"custom","prompt":"Mark T046 deferred, then specify feature 2."}')?.action).toBe('custom')
  expect(parseSteer('{"action":"custom","prompt":""}')?.action).toBe('plan')
  expect(parseSteer('{"action":"pause"}')?.question).toBe('the person wants to decide how to go on')
  expect(parseSteer('nothing')).toBeNull()
})

test('found live: your words mid-run come first; a delegated step does not hold your turn, and the deputy turns your change of course into the next step', async ($, on) => {
  // As in the desktop app, where each step rides the Stop hook at the end of a turn.
  const custom = JSON.stringify({ action: 'custom', prompt: 'Mark T005 to T008 deferred with [~] (the person put them off) and close the feature; then start the next feature from the roadmap.', note: '', question: '' })
  const seen = project(on, { ...DEMO }, { surfaces: ['desktop'], replies: [custom] })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  await xref($, 'auto on')
  await $.turn.start({ text: 'Go on', turnId: 't0' })
  const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Ready.' } as never)
  expect(first.block).toContain('subagent_type "speckit-xref:implementer"')
  await $.turn.complete({ reason: 'answer', answer: 'Ready.', durationMs: 1000, isAborted: false, turnId: 't0' })
  // The delegated step still stands: the session's own write is refused.
  expect((await $.tool.check(WRITE as never)).decision).toBe('deny')
  // The person speaks: the step is superseded, and nothing of the autopilot's holds their turn.
  await type($, 'Schließ Feature 1 ab, die restlichen Aufgaben verschieben wir auf später.')
  expect((await $.tool.check(WRITE as never)).decision).not.toBe('deny')
  await $.turn.start({ text: 'Schließ Feature 1 ab, die restlichen Aufgaben verschieben wir auf später.', turnId: 't1' })
  const after = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Gut, ich schließe Feature 1 ab.' } as never)
  expect(after.block).toContain('] adjust: The person changed course')
  expect(after.block).toContain('The person said, mid-run: "Schließ Feature 1 ab')
  expect(after.block).toContain('Mark T005 to T008 deferred')
  expect(seen.completes.at(-1)).toContain("## The person's words")
  expect(seen.completes.at(-1)).toContain("## The autopilot's planned next step")
})

test('the deputy keeps the plan where your words leave it standing, and waits where you want to decide', async ($, on) => {
  const spawned: any[] = []
  on('agent.spawn', ($: any, e: any) => {
    spawned.push(e)
    return { model: e.model, agentId: 'agent-1' }
  })
  const seen = project(on, { ...DEMO }, {
    surfaces: ['desktop'],
    replies: [JSON.stringify({ action: 'plan', note: 'The person prefers short German UI texts.' }), JSON.stringify({ action: 'pause', question: 'You want to look at the login flow yourself first.' })],
  })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await type($, 'Bitte kurze deutsche Texte in der Oberfläche.')
  await $.turn.start({ text: 'Bitte kurze deutsche Texte in der Oberfläche.', turnId: 't1' })
  const planned = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Notiert.' } as never)
  expect(planned.block).toContain('] implement:')
  // The deputy's note travels in the brief of the agent that does the step.
  await $.agent.spawn({ subagentType: 'speckit-xref:implementer', prompt: 'Carry out your brief.', description: 'x' } as never)
  expect(spawned.at(-1).prompt).toContain("The person's deputy on the last step: The person prefers short German UI texts.")
  await $.turn.complete({ reason: 'answer', answer: 'Notiert.', durationMs: 1000, isAborted: false, turnId: 't1' })
  await type($, 'Warte mal, ich will mir den Login-Flow erst selbst anschauen.')
  await $.turn.start({ text: 'Warte mal, ich will mir den Login-Flow erst selbst anschauen.', turnId: 't2' })
  const waited = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Ok.' } as never)
  expect(waited.block).toBeUndefined()
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: You want to look at the login flow yourself first.')
})

test('a step whose work shows the plan no longer fits is redirected by the deputy', { options: { orchestrate: 'off' } }, async ($, on) => {
  const redirect = JSON.stringify({ verdict: 'redirect', prompt: 'T006 needs the mail service of feature 2: mark it deferred with [~] and the reason, then go on with T007.', note: '', rework: [], question: '', recommendation: '', profile: [] })
  const seen = project(on, { ...DEMO }, { replies: [redirect] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await runTurn($, 'T004 done; T006 needs a mail service that feature 2 brings.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('] adjust: The last step showed that the plan no longer fits')
  expect(autopilotPrompts(seen).at(-1)).toContain('T006 needs the mail service of feature 2')
})

test('Claude pauses the run at your word; stopping it altogether stays your command', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const paused = await $.tool.call({ tool: 'mcp__speckit-xref__pause', reason: 'the person takes over' } as never)
  expect(String(paused.result)).toContain('The autopilot is paused')
  expect(seen.toasts.at(-1)).toContain("paused at the person's word: the person takes over")
})

test('found live: in the desktop app your first words after a restart are heard, not turned into the first step', { options: { autopilot: 'on' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { surfaces: ['desktop'], replies: [JSON.stringify({ action: 'pause', question: 'You close feature 1 yourself first.' })] })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  await type($, 'Ja, abschließen und Feature 2 anlegen.')
  // Nothing of a step rides the person's prompt, and no delegation holds their turn.
  expect(JSON.stringify(seen.submitted.at(-1).context ?? [])).not.toContain('[speckit-xref autopilot')
  expect((await $.tool.check(WRITE as never)).decision).not.toBe('deny')
  await $.turn.start({ text: 'Ja, abschließen und Feature 2 anlegen.', turnId: 't1' })
  const end = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Ich schließe ab.' } as never)
  expect(end.block).toBeUndefined()
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: You close feature 1 yourself first.')
})

test('words typed while a step runs wait for your turn: the step keeps its gate and review, and the deputy reads your turn', { options: { orchestrate: 'off' } }, async ($, on) => {
  const go = JSON.stringify({ verdict: 'go', note: '', rework: [], question: '', recommendation: '', prompt: '', profile: [] })
  const plan = JSON.stringify({ action: 'plan', note: '' })
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, replies: [go, plan] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const step = autopilotPrompts(seen).at(-1)!
  await $.turn.start({ text: step, turnId: 's1' })
  await type($, 'Bitte auch an die Fehlermeldungen denken.')
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await $.turn.complete({ reason: 'answer', answer: 'T004 done.', durationMs: 1000, isAborted: false, turnId: 's1' })
  await seen.clock.advance(0)
  // The step was the autopilot's: logged and reviewed; the next step waits for the person's turn.
  const log = seen.files[`.specify/xref/local/${FEATURE.slice(6)}.run.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(log.some((r: any) => r.phase === 'implement')).toBe(true)
  expect(log.some((r: any) => r.phase === 'deputy' && r.outcome.startsWith('go'))).toBe(true)
  expect(autopilotPrompts(seen).at(-1)).toBe(step)
  await $.turn.start({ text: 'Bitte auch an die Fehlermeldungen denken.', turnId: 'p1' })
  await $.turn.complete({ reason: 'answer', answer: 'Mache ich: klare Fehlermeldungen.', durationMs: 1000, isAborted: false, turnId: 'p1' })
  await seen.clock.advance(0)
  expect(seen.completes.at(-1)).toContain('Mache ich: klare Fehlermeldungen.')
  expect(autopilotPrompts(seen).at(-1)).not.toBe(step)
})
