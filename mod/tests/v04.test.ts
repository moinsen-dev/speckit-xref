import { expect, test } from 'claude-code/testing'

import { localPath } from '../hooks/ledger'
import { DEMO } from './fixtures/demo'
import { BAND, FEATURE, PANE, ROOT, ledgerOf, project, startSession, toText, type, xref } from './harness'

// 0.4.0: proof instead of claims, a spec gate, test-gated progress, guard rails, and the fixes the review found.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const turn = ($: any, answer = 'Done with this step.', reason = 'answer') =>
  $.turn.complete({ reason, answer, durationMs: 1000, isAborted: reason === 'aborted', turnId: `t-${Math.random()}` })
const tick = (task: string) => (seen: any) => seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace(`- [ ] ${task}`, `- [x] ${task}`))

/** The demo before planning: a settled spec, no plan, no tasks. */
function specOnly(): Record<string, string> {
  const files: Record<string, string> = { ...DEMO }
  delete files[`${FEATURE}/plan.md`]
  delete files[`${FEATURE}/tasks.md`]
  files[`${FEATURE}/spec.md`] = files[`${FEATURE}/spec.md`]!.replace('rate-limit link requests to [NEEDS CLARIFICATION: how many per hour?]', 'rate-limit link requests to five per hour.')
  return files
}

test('in a repository without Spec Kit the tools wait behind ToolSearch and nothing polls', async ($, on) => {
  const seen = project(on, { 'README.md': '# app\n', 'src/index.ts': 'export {}\n' })
  await startSession($)
  expect(seen.deferred).toEqual(['focus', 'where', 'status', 'ask', 'link'])
  const runs = seen.ran.length
  await seen.clock.advance(20_000)
  expect(seen.ran.length).toBe(runs)
})

test('an API error or a refusal pauses the autopilot instead of handing on the next step', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await turn($, '', 'error')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe('Autopilot waits for you: the turn ended with an error; Resume tries again')
})

test('the spec gate: the autopilot stops at the written spec and never approves it itself', async ($, on) => {
  const seen = project(on, specOnly())
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  expect(seen.toasts.at(-1)).toContain('Review the spec against your words')
  // The native dialog asked; dismissed, the run keeps waiting.
  expect(seen.asked[0]).toContain('Approve the spec as the contract?')
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  expect(ledgerOf(seen.files)?.approvals?.spec).toBeUndefined()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('You said: "Users sign in with a one-time link sent by email. No passwords."')
  expect(drawn).toContain('Out of scope: Password-based login · Social login (Google, GitHub)')
  await pane.press({ key: 'approve' })
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).approvals.spec).toHaveLength(64)
  expect(autopilotPrompts(seen)[0]).toContain('plan: The spec is written; plan.md is missing.')
})

test('approving in the dialog lets the run go on in place', async ($, on) => {
  const seen = project(on, specOnly(), { answers: ['Approve spec'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('Run /speckit-plan now')
})

test('review: none plans without the gate', { options: { review: 'none' } }, async ($, on) => {
  const seen = project(on, specOnly())
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('Run /speckit-plan now')
})

test('failing tests become repair steps; after three repairs the person decides', async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [1] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 4; i++) {
    await turn($)
    await seen.clock.advance(0)
  }
  const prompts = autopilotPrompts(seen)
  expect(seen.testRuns).toEqual(['npx vitest run', 'npx vitest run', 'npx vitest run', 'npx vitest run'])
  expect(prompts.map(p => /\] (\w+): .*?\((repair \d of 3)\)|\] (\w+):/.exec(p)!.slice(1).filter(Boolean).join(' '))).toEqual(['implement', 'repair repair 1 of 3', 'repair repair 2 of 3', 'repair repair 3 of 3'])
  expect(prompts[1]).toContain('FAIL tests/auth/token.test.ts')
  expect(seen.toasts.at(-1)).toContain('The tests still fail after 3 attempts')
})

test('a repair that makes the tests pass goes back to the tasks', async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [1, 0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await turn($)
  await seen.clock.advance(0)
  tick('T004')(seen)
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[2]).toContain('implement: 4 of 8 tasks open; next T005.')
})

test('a passing suite proves the requirements that have a real test', async ($, on) => {
  const files = {
    ...DEMO,
    'tests/auth/token.test.ts': "// @spec 001-magic-link-login/FR-002\ntest('issues a single-use token', () => {})\n",
    [`${FEATURE}/tasks.md`]: DEMO[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'),
  }
  const seen = project(on, files, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await turn($)
  await seen.clock.advance(0)
  const ledger = ledgerOf(seen.files)
  expect(ledger.verification['FR-002'].status).toBe('passing')
  expect(Object.keys(ledger.verification)).toEqual(['FR-002'])
  // Verification is local; the committed half keeps only the fingerprint it was proven against.
  expect(seen.files[`${FEATURE}/xref.json`]).not.toContain('passing')
  expect(JSON.parse(seen.files[`${FEATURE}/xref.json`]!).fingerprints['FR-002']).toHaveLength(64)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('Proofspec 1 · plan 3 · impl 0 · test 0 · pass 1')
})

test('the ask tool takes the person\'s answer in the same turn, and the run goes on', async ($, on) => {
  const seen = project(on, { ...DEMO }, { answers: ['Per email'] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const asked = await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Rate limit per email or per IP?', options: ['Per email', 'Per IP'] } as never)
  expect(asked.result).toContain('The person answered: Per email.')
  tick('T004')(seen)
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
  expect(ledgerOf(seen.files).decisions[0]).toMatchObject({ id: 'D1', question: 'Rate limit per email or per IP?', answer: 'Per email' })
})

test('a question that blocks one story waits in the queue while the rest goes on', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const asked = await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Which mail provider?', options: ['SMTP', 'SES'], blocks: ['US2'] } as never)
  expect(asked.result).toContain('Leave US2 alone and go on')
  tick('T004')(seen)
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('DecideD1 Which mail provider?')
  await pane.select({ key: 'decide-D1', value: 'SES' })
  expect(seen.submitted.at(-1).text).toBe('Decision D1 (Which mail provider?): SES. Apply it to US2.')
})

test('guard rails: while the autopilot runs, destructive commands and secrets wait for the person', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' } })).decision).toBe('allow')
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const push = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' } })
  expect(push).toMatchObject({ decision: 'deny' })
  expect(push.reason).toContain('pushing is the person\'s call')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Write', input: { file_path: `${ROOT}/.env.local` } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Write', input: { file_path: `${ROOT}/.env.example` } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'npx vitest run' } })).decision).toBe('allow')
})

test('files Bash changed during a turn are booked like any write', async ($, on) => {
  let changed = ['src/auth/token.ts']
  const seen = project(on, { ...DEMO }, { changed: () => changed })
  await startSession($)
  await $.turn.start({ text: 'regenerate the theme', turnId: 'turn-7' })
  seen.write('src/ui/theme.ts', 'export const dark = true\n')
  changed = ['src/auth/token.ts', 'src/ui/theme.ts']
  await turn($)
  await seen.clock.advance(0)
  // The file dirty before the turn and unchanged since is not this turn's.
  expect(ledgerOf(seen.files).unplanned.map((u: any) => u.file)).toEqual(['src/ui/theme.ts'])
})

test('/xref-stop ends the autopilot and the turn it is running, at once', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.turn.start({ text: '', turnId: 'turn-9' })
  expect((await $.command.run({ command: 'xref-stop', args: '' } as never)).text).toBe('Autopilot off; its running step was stopped.')
  expect(seen.aborted).toEqual(['turn-9'])
  expect((await xref($, 'auto')).text).toBe('Autopilot off. /xref auto on [steps] starts it.')
})

test('Spec Kit\'s own skills get the feature\'s state; a compaction keeps the task and the requests', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  const implement = await $.skill.prompt({ skill: 'speckit-implement', text: 'Implement the tasks.' })
  expect(implement.text).toContain('## speckit-xref: where this feature stands')
  expect(implement.text).toContain('Current task: T004')
  expect((await $.skill.prompt({ skill: 'commit', text: 'Commit.' })).text).toBe('Commit.')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Implement T004.', toolUses: [] }] } as never)
  expect(seen.compacted[0]).toContain('the current task T004')
})

test('a pause shows the whole question in the band with the way on, names the tab, and reminds after five minutes', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'pane')
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'How many link requests per hour (FR-005)?' } as never)
  await turn($)
  await seen.clock.advance(0)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = toText(await band.drawn())
  expect(text).toContain('⏸ How many link requests per hour (FR-005)?')
  expect(text).toContain('[Resume] [Stop] [Pane]')
  expect(seen.openArgs.at(-1).title).toBe('Spec X-Ref ⏸')
  await seen.clock.advance(5 * 60_000)
  expect(seen.notified).toContain('Autopilot waits for you: How many link requests per hour (FR-005)?')
})

test('a night run ends with a briefing for the morning', async ($, on) => {
  const done = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: done }, { tests: { exits: [0] } })
  await startSession($)
  expect((await xref($, 'auto night')).text).toContain('Night run on: up to 100 steps')
  await seen.clock.advance(0)
  for (let i = 0; i < 2; i++) {
    await turn($)
    await seen.clock.advance(0)
  }
  expect(seen.files['.specify/xref/local/briefing.md']).toContain('Ended: Autopilot done')
  expect(seen.notified.at(-1)).toContain('Autopilot done')
  // Handing over converge recorded its checkpoint; no approval was written on the person's behalf.
  const ledger = ledgerOf(seen.files)
  expect(Object.keys(ledger.checkpoints)).toEqual(['converge'])
  expect(ledger.approvals).toEqual({})
  expect(seen.files[localPath(FEATURE)]).toContain('"checkpoints"')
})

test('a request beyond the spec becomes one revise step, not a loop', async ($, on) => {
  const verdict = JSON.stringify({ score: 70, verdict: 'minor', reasons: ['adds SMS'], intent_changes: [{ text: 'also send the link by SMS', kind: 'extends' }] })
  const seen = project(on, { ...DEMO }, { fork: verdict })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await type($, 'also send the link by SMS')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await turn($)
  await seen.clock.advance(10)
  const prompts = autopilotPrompts(seen)
  expect(prompts[1]).toContain('revise: "also send the link by SMS" goes beyond the spec')
  expect(prompts[1]).toContain('Run /speckit-clarify The user asked during implementation: "also send the link by SMS".')
  await turn($)
  await seen.clock.advance(10)
  expect(autopilotPrompts(seen)[2]).not.toContain('revise:')
})

test('headless: in a -p run the Stop hook hands the next step over as its re-prompt', { options: { autopilot: 'on' } }, async ($, on) => {
  const seen = project(on, { ...DEMO })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Ready.' } as never)
  expect(first.block).toContain('[speckit-xref autopilot · step 1/25] implement')
  expect(autopilotPrompts(seen)).toHaveLength(0)
  tick('T004')(seen)
  const second = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'T004 done.' } as never)
  expect(second.block).toContain('step 2/25')
  // A question for the person ends the -p run instead of re-prompting.
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Per email or per IP?' } as never)
  expect((await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Per email or per IP?' } as never)).block).toBeUndefined()
})

test('parallel: a phase\'s [P] tasks go to task-runner subagents', { options: { parallel: 'on' } }, async ($, on) => {
  const tasks = DEMO[`${FEATURE}/tasks.md`]!.replace('- [ ] T004 [US1]', '- [ ] T004 [P] [US1]').replace('- [ ] T005 [US1]', '- [ ] T005 [P] [US1]')
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: tasks })
  await startSession($)
  expect(seen.agents).toEqual(['task-runner'])
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('Parallel: T004, T005 are marked [P] and touch different files. Spawn one speckit-xref:task-runner agent per task')
})

test('commit per task: a step whose tests pass commits the tasks it checked, on a feature branch', { options: { commitPerTask: 'on' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, branch: '001-magic-link-login' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  tick('T004')(seen)
  await turn($)
  await seen.clock.advance(10)
  const commit = seen.ran.find(argv => argv[0] === 'git' && argv[1] === 'commit')
  expect(commit?.[3]).toBe('T004: Implement token service in src/auth/token.ts (FR-002)')
  expect(seen.ran.find(argv => argv[0] === 'git' && argv[1] === 'add')).toEqual(['git', 'add', '--', 'src/auth/token.ts', `${FEATURE}/tasks.md`, `${FEATURE}/xref.json`])
  expect(seen.toasts).toContain('Autopilot: committed T004')
})

test('commit per task never commits on main', { options: { commitPerTask: 'on' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, branch: 'main' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  tick('T004')(seen)
  await turn($)
  await seen.clock.advance(10)
  expect(seen.ran.some(argv => argv[0] === 'git' && argv[1] === 'commit')).toBe(false)
})
