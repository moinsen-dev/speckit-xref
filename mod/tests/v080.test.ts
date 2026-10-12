import { expect, test } from 'claude-code/testing'

import { flowIncludes } from '../hooks/accept'
import { LEAN_TESTS, treeOf, verifyKey } from '../hooks/brief'
import { IMPLEMENTER, IMPLEMENTER_PROMPT, TESTER, implementBrief, relayPrompt, routeModel, tryBrief, writesCode } from '../hooks/orchestrate'
import { emptyLedger } from '../hooks/xref'
import { nextStep, phaseStrip, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom, specFingerprint } from '../hooks/rules'
import type { Ledger, Snapshot, Task } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.8.0: the mod orchestrates. Heavy steps run in subagents with a fresh context and a model per step, the session
// relays; the user test tries each story and the whole app as a person would; tests prove requirements, not tasks.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const SPEC = parseSpec(DEMO[`${FEATURE}/spec.md`]!)
const TASKS = DEMO[`${FEATURE}/tasks.md`]!
const DONE = TASKS.replace(/- \[ \]/g, '- [x]')

function snapOf(tasksMd: string, extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(tasksMd)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: SPEC, tasks, constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
    commandStyle: 'skills', rules: rulesFrom(null), realTests: [], planFingerprint: 'p', testCommand: 'npm test', branch: null,
    phase: tasks.find(t => !t.done)?.phase ?? null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge', 'analyze'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: false, platforms: { web: true, ios: true, android: false }, ...extra,
  } as unknown as Snapshot
}
const task = (paths: string[]): Task => ({ id: 'T001', done: false, parallel: false, story: null, text: 'x', paths, reqs: [], phase: 'Phase 1: Setup' })

test('routing: Sonnet builds and repairs, Opus takes over a repair that failed, Haiku does docs and configuration; a fixed option wins', () => {
  expect(routeModel('implement', 'auto', { tasks: [task(['src/auth/token.ts'])] })).toBe('sonnet')
  expect(routeModel('implement', 'auto', { tasks: [task(['package.json', 'README.md']), task(['eslint.config.js', '.gitignore'])] })).toBe('haiku')
  expect(routeModel('implement', 'auto', { tasks: [task(['package.json']), task(['src/x.ts'])] })).toBe('sonnet')
  expect(routeModel('repair', 'auto', { repairs: 1 })).toBe('sonnet')
  expect(routeModel('repair', 'auto', { repairs: 2 })).toBe('opus')
  expect(routeModel('try', 'auto')).toBe('sonnet')
  expect(routeModel('implement', 'opus', { tasks: [task(['README.md'])] })).toBe('opus')
})

test('the session relays and writes no code while a step is delegated; the record and reading, testing and git pass', () => {
  expect(writesCode('Write', { file_path: '/work/src/a.ts' }, '/work')).toBe(true)
  expect(writesCode('Edit', { file_path: '/work/specs/001-x/tasks.md' }, '/work')).toBe(false)
  expect(writesCode('Write', { file_path: '/work/.specify/memory/runbook.md' }, '/work')).toBe(false)
  expect(writesCode('Bash', { command: 'cat > src/a.ts <<EOF\nx\nEOF' })).toBe(true)
  expect(writesCode('Bash', { command: 'echo done >> notes.txt' })).toBe(true)
  expect(writesCode('Bash', { command: "sed -i '' 's/a/b/' src/a.ts" })).toBe(true)
  expect(writesCode('Bash', { command: 'npm test 2>&1 | tail -20' })).toBe(false)
  expect(writesCode('Bash', { command: 'npx tsc --noEmit > /dev/null' })).toBe(false)
  expect(writesCode('Bash', { command: 'git add -A && git commit -m "x"' })).toBe(false)
  expect(writesCode('Bash', { command: 'echo "- x" >> .specify/memory/runbook.md' })).toBe(false)
  expect(writesCode('Read', { file_path: '/work/src/a.ts' }, '/work')).toBe(false)
  const relay = relayPrompt({ agent: IMPLEMENTER, model: 'sonnet', description: 'Implement US1', brief: 'b' })
  expect(relay).toContain('subagent_type "speckit-xref:implementer"')
  expect(relay).toContain('the prompt "Carry out your brief."')
  expect(relay).toContain('Writing code in this turn is refused')
})

test('orchestrated: an implement step is relayed with its brief and model; a failing suite is repaired by the agent, Opus after a failed repair', () => {
  const snap = snapOf(TASKS)
  const ledger: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: specFingerprint(SPEC) } }
  const step = nextStep(snap, ledger, null, { review: 'none', orchestrate: true })
  const impl = step.phase === 'implement' ? step : nextStep(snap, { ...ledger, requirements: { 'FR-001': { tasks: ['T001'], files: [], sources: [] } } }, null, { review: 'none', orchestrate: true })
  expect(impl.phase).toBe('implement')
  expect(impl.delegate?.agent).toBe(IMPLEMENTER)
  expect(impl.delegate?.model).toBe('sonnet')
  expect(impl.prompt).toContain('subagent_type "speckit-xref:implementer"')
  expect(impl.delegate?.brief).toContain(`Phase: ${snap.phase}.`)
  expect(impl.delegate?.brief).toContain('Test command: `npm test`.')
  expect(impl.delegate?.brief).toContain(LEAN_TESTS)
  const failing = { ok: false, at: '', output: 'FAIL tests/auth/token.test.ts' }
  const repair = nextStep(snap, ledger, null, { review: 'none', orchestrate: true, lastTest: failing, repairs: 1 })
  expect([repair.phase, repair.delegate?.model]).toEqual(['repair', 'sonnet'])
  expect(repair.delegate?.brief).toContain('FAIL tests/auth/token.test.ts')
  expect(nextStep(snap, ledger, null, { review: 'none', orchestrate: true, lastTest: failing, repairs: 2 }).delegate?.model).toBe('opus')
  // Off: the session does it itself, as before.
  expect(nextStep(snap, ledger, null, { review: 'none', lastTest: failing, repairs: 1 }).delegate).toBeUndefined()
  expect(implementBrief(snap, snap.phase!, null)).toContain('Tasks (tasks.md):')
})

test('the user test: a story just built is tried before the next phase; the whole app before done; its log and shots change nothing verified', () => {
  // The first phase done, the second open: the first is a story phase only when its title names one.
  const tasksMd = TASKS.replace('## Phase 1', '## Phase 1: User Story 1 - Request a link').replace(/(## Phase 1[^\n]*\n(?:[^#][^\n]*\n)*)/, s => s.replace(/- \[ \]/g, '- [x]'))
  const snap = snapOf(tasksMd, { ui: true })
  const ledger: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: 'x' }, requirements: { 'FR-001': { tasks: ['T001'], files: [], sources: [] } } }
  const story = nextStep(snap, ledger, null, { review: 'none', userTest: true, orchestrate: true })
  if (story.phase === 'try') {
    expect(story.approve?.key).toMatch(/^try:\d+$/)
    expect(story.delegate?.agent).toBe(TESTER)
    expect(story.delegate?.brief).toContain('Try the story just built')
    expect(nextStep(snap, { ...ledger, checkpoints: { ...ledger.checkpoints, [story.approve!.key]: story.approve!.value } }, null, { review: 'none', userTest: true, orchestrate: true }).phase).not.toBe('try')
  }
  // The whole app before done, once per tree.
  const done = snapOf(DONE, { ui: true })
  const key = verifyKey(done, tasksFingerprint(done.tasks))
  const verified: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { converge: tasksFingerprint(done.tasks), verify: key } }
  const final = nextStep(done, verified, null, { review: 'none', userTest: true })
  expect([final.phase, final.approve]).toEqual(['try', { key: 'try', value: key }])
  expect(final.prompt).toContain('You test an app the way a person uses it')
  expect(final.prompt).toContain('mcp__Claude_Code_iOS_Simulator__control')
  expect(final.prompt).toContain("channel: 'chrome'")
  expect(phaseStrip(done, final)).toContain('▶verify')
  expect(nextStep(done, { ...verified, checkpoints: { ...verified.checkpoints, try: key } }, null, { review: 'none', userTest: true, acceptance: false }).phase).toBe('done')
  expect(nextStep(done, verified, null, { review: 'none' }).phase).not.toBe('try')
  const base = '100644 blob a1\tsrc/auth/token.ts'
  expect(treeOf(`${base}\nh1 ${FEATURE}/try.md\nh2 ${FEATURE}/try/us1-end.png`)).toBe(treeOf(base))
  expect(tryBrief(done, { story: null })).toContain(`${FEATURE}/try.md`)
})

test('Fund 39: a flow\'s sub-flows are found relative to it', () => {
  expect(flowIncludes('- runFlow: common/start.yaml\n- runFlow:\n    file: ../shared/login.yaml\n', 'e2e/acceptance/US1-AS1.yaml')).toEqual(['e2e/acceptance/common/start.yaml', 'e2e/shared/login.yaml'])
  expect(flowIncludes('- tapOn: "x"', 'e2e/acceptance/a.yaml')).toEqual([])
})

test('orchestrated live: the relay prompt, the spawn gets the model and the brief in the foreground, the main loop may not write code, the run log names the model', async ($, on) => {
  const spawned: any[] = []
  on('agent.spawn', ($: any, e: any) => {
    spawned.push(e)
    return { model: e.model, agentId: 'agent-1' }
  })
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  // Analyze first, then the first phase.
  for (let i = 0; i < 4 && !autopilotPrompts(seen).at(-1)?.includes('] implement:'); i++) {
    await runTurn($)
    await seen.clock.advance(0)
  }
  const relay = autopilotPrompts(seen).at(-1)!
  expect(relay).toContain('] implement:')
  expect(relay).toContain('subagent_type "speckit-xref:implementer"')
  // The session's own write is refused; the agent's goes through.
  const write = { tool: 'Write', input: { file_path: '/work/src/auth/token.ts', content: 'x' } }
  const denied = await $.tool.check(write as never)
  expect(denied.decision).toBe('deny')
  expect(denied.reason).toContain('this step is delegated')
  expect((await $.tool.check({ ...write, agentId: 'agent-1' } as never)).decision).not.toBe('deny')
  // The relay's spawn: the mod sets the model, the brief and the foreground run.
  await $.agent.spawn({ subagentType: 'speckit-xref:implementer', prompt: 'Carry out your brief.', description: 'x' } as never)
  expect(spawned.at(-1)).toMatchObject({ model: 'sonnet', background: false })
  expect(spawned.at(-1).prompt).toContain('Tasks (tasks.md):')
  await runTurn($, 'Phase done: T001, T002.')
  await seen.clock.advance(0)
  const log = seen.files[`.specify/xref/local/${FEATURE.slice(6)}.run.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(log.filter((r: any) => r.phase === 'implement').at(-1)).toMatchObject({ model: 'sonnet' })
  // The next step is relayed again, with its own brief: the delegation follows the steps.
  const next = autopilotPrompts(seen).at(-1)!
  expect(next).not.toBe(relay)
  if (next.includes('] implement:')) expect(next).toContain('subagent_type "speckit-xref:implementer"')
})

test('Fund 38: a file written and committed in the same turn is booked, and its anchors and tests count', async ($, on) => {
  let head = 'aaa1111'
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, head: () => head, changed: since => (since === 'aaa1111' ? ['src/auth/new-flow.ts', 'tests/auth/new-flow.test.ts'] : []) })
  await startSession($)
  await $.prompt.submit({ text: 'Add the new flow', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Add the new flow', turnId: 't38' })
  // Written by Bash and committed before the turn ends: the working tree is clean against the new HEAD.
  seen.write('src/auth/new-flow.ts', '// @spec 001-magic-link-login/FR-001\nexport const flow = 1\n')
  seen.write('tests/auth/new-flow.test.ts', "// @spec 001-magic-link-login/FR-001\ntest('FR-001 sends a link', () => { expect(1).toBe(1) })\n")
  head = 'bbb2222'
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't38' })
  const ledger = ledgerOf(seen.files)
  const touched = JSON.stringify(ledger)
  expect(touched).toContain('src/auth/new-flow.ts')
  expect((ledger.anchors ?? []).some((a: any) => a.file === 'tests/auth/new-flow.test.ts')).toBe(true)
})

test('a done feature leaves a handoff, and the pane says /clear keeps the context small', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot done:')
  const handoff = seen.files['.specify/xref/local/handoff.md']!
  expect(handoff).toContain(`# Handoff: ${FEATURE}`)
  expect(handoff).toContain('/clear before it keeps the context small')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('Before the next feature: /clear keeps the context small')
})

test('Fund 40: a check by hand counts only when done now; one the agent cannot do waits for the person instead of being relayed again', async ($, on) => {
  expect(IMPLEMENTER_PROMPT).toContain('results written down earlier (quickstart.md, notes, an older run) are no evidence')
  expect(LEAN_TESTS).toContain('fixes them (a set date and time, a seeded random)')
  on('agent.spawn', ($: any, e: any) => ({ model: e.model, agentId: 'agent-1' }))
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 4 && !autopilotPrompts(seen).at(-1)?.includes('] implement:'); i++) {
    await runTurn($)
    await seen.clock.advance(0)
  }
  const relayed = autopilotPrompts(seen).length
  expect(autopilotPrompts(seen).at(-1)).toContain('subagent_type "speckit-xref:implementer"')
  // The agent finds no simulator for the native smoke test: it leaves the task open and asks.
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'No simulator here for the native smoke test (T004): will you run it?', agentId: 'agent-1' } as never)
  await runTurn($, 'T004 left open: no simulator here; asked the person.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(relayed)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: No simulator here')
})
