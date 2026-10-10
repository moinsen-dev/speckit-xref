import { expect, test } from 'claude-code/testing'

import { localPath } from '../hooks/ledger'
import { parseSpec } from '../hooks/speckit'
import { testCommandFrom, testScriptCommand } from '../hooks/workflow'
import { DEMO } from './fixtures/demo'
import { BAND, FEATURE, PANE, ROOT, ledgerOf, project, runTurn, startSession, toText, type, xref } from './harness'

// 0.4.1: the findings of the first live greenfield run (an Expo app, autopilot from tasks to phase 1).

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const tick = (seen: any, task: string) => seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace(`- [ ] ${task}`, `- [x] ${task}`))

function specOnly(): Record<string, string> {
  const files: Record<string, string> = { ...DEMO }
  delete files[`${FEATURE}/plan.md`]
  delete files[`${FEATURE}/tasks.md`]
  files[`${FEATURE}/spec.md`] = files[`${FEATURE}/spec.md`]!.replace('rate-limit link requests to [NEEDS CLARIFICATION: how many per hour?]', 'rate-limit link requests to five per hour.')
  return files
}

test('a multi-line Input is the person\'s whole text, without the quotes', () => {
  const spec = parseSpec('# Feature Specification: X\n\n**Input**: User description: "Build an Astro web app.\nThings that matter:\n- the budget\n\nOn second thought, make it an Expo app."\n\n## Requirements\n')
  expect(spec.input).toBe('Build an Astro web app.\nThings that matter:\n- the budget\n\nOn second thought, make it an Expo app.')
  expect(parseSpec('**Input**: User description: "One line."\n').input).toBe('One line.')
})

test('Start while a turn runs waits for its end, then hands over exactly one step at a time', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await $.turn.start({ text: 'Explain the token service.', turnId: 'person-1' })
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  await $.turn.complete({ reason: 'answer', answer: 'It issues tokens.', durationMs: 1000, isAborted: false, turnId: 'person-1' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  // The person's turn was no step of the autopilot's: nothing in the run log, no test run.
  expect(seen.files[`.specify/xref/local/001-magic-link-login.run.jsonl`]).toBeUndefined()
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
  expect(autopilotPrompts(seen)[1]).toContain('step 2/25')
})

test('a step that asks the person stops the run: no second step is already waiting behind it', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await $.turn.start({ text: 'Explain the token service.', turnId: 'person-1' })
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.turn.complete({ reason: 'answer', answer: 'Sure.', durationMs: 1000, isAborted: false, turnId: 'person-1' })
  await seen.clock.advance(0)
  await $.turn.start({ text: autopilotPrompts(seen)[0]!, turnId: 'step-1' })
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Per email or per IP?' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Per email or per IP?', durationMs: 1000, isAborted: false, turnId: 'step-1' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe('Autopilot waits for you: Per email or per IP?')
})

test('the person\'s own /speckit-plan approves the spec it plans; the model\'s never does', async ($, on) => {
  const seen = project(on, specOnly())
  await startSession($)
  await $.command.run({ command: 'speckit-plan', args: '', origin: { kind: 'plugin', name: 'other' } } as never)
  expect(ledgerOf(seen.files)?.approvals?.spec).toBeUndefined()
  await type($, 'passt, weiter mit /speckit-plan')
  expect(ledgerOf(seen.files).approvals.spec).toHaveLength(64)
  expect(seen.toasts.at(-1)).toBe('Approved the spec: you ran /speckit-plan.')
})

test('a plan written without the person\'s approval shows as ◌spec, and the status tool says so', async ($, on) => {
  project(on, { ...DEMO })
  await startSession($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('✓setup ✓const ◌spec ✓plan ✓tasks ▶impl 3/8 ·verify')
  expect((await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)).result).toContain('Spec review: not approved by the person (do not say it is)')
})

test('the review card puts Approve first; at a review the band offers Approve instead of Resume', async ($, on) => {
  const seen = project(on, specOnly())
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const drawn = toText(await (await $.ui.mount({ ...PANE, surface: 'terminal' })).drawn())
  expect(drawn.indexOf('[Approve spec]')).toBeGreaterThan(-1)
  expect(drawn.indexOf('[Approve spec]')).toBeLessThan(drawn.indexOf('FR-001'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(toText(await band.drawn())).toContain('[Approve spec] [Stop] [Pane]')
  await band.press({ key: 'band-approve' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('Run /speckit-plan now')
})

test('the test command: the project\'s script first; a package name in plan.md is no command', () => {
  expect(testScriptCommand('{"scripts":{"test":"jest"}}', { pnpm: false, yarn: false, bun: false })).toBe('npm test')
  expect(testScriptCommand('{"scripts":{"test":"vitest"}}', { pnpm: true, yarn: false, bun: false })).toBe('pnpm test')
  expect(testScriptCommand('{"scripts":{"test":"jest --watchAll"}}', { pnpm: false, yarn: false, bun: false })).toBe(null)
  expect(testScriptCommand('{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}', { pnpm: false, yarn: false, bun: false })).toBe(null)
  expect(testCommandFrom('**Testing**: Jest mit `jest-expo`, @testing-library/react-native')).toBe('npx jest')
  expect(testCommandFrom('**Testing**: `pnpm vitest run` (Vitest)')).toBe('pnpm vitest run')
})

test('package.json\'s test script is the test command, ahead of plan.md', async ($, on) => {
  project(on, { ...DEMO, 'package.json': '{"scripts":{"test":"jest"}}' })
  await startSession($)
  expect((await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)).result).toContain('Test command: npm test')
})

test('a test command that is not there is no failing test: no repair step, a note instead', async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [127], output: 'sh: jest-expo: command not found' } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  tick(seen, 'T004')
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[1]).toContain('implement: 4 of 8 tasks open; next T005.')
  expect(seen.toasts).toContain('Autopilot: the test command could not run (npx vitest run: sh: jest-expo: command not found). Set testCommand in /config.')
  const pane = toText(await (await $.ui.mount({ ...PANE, surface: 'terminal' })).drawn())
  expect(pane).toContain('Testscould not run')
})

test('an analysis that found something is followed by its remediation, then the tasks', async ($, on) => {
  const files = { ...DEMO, [`${FEATURE}/tasks.md`]: DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[x\]/g, '- [ ]') }
  const seen = project(on, files)
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('analyze: Before the first task')
  await runTurn($, '| C1 | Gap | HIGH | … |\n\nShall I apply the changes for C1 and I1?')
  await seen.clock.advance(0)
  expect(seen.classified).toHaveLength(0)
  expect(autopilotPrompts(seen)[1]).toContain('remediate: The analysis found inconsistencies')
  expect(autopilotPrompts(seen)[1]).toContain('Keep every existing id')
  expect(ledgerOf(seen.files).checkpoints.remediate).toBe('done')
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[2]).toContain('implement:')
})

test('scaffold images and tooling dotfiles are unclear, not drift; the run log names tasks only for work on them', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/assets/images/icon.png`, content: 'png' })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/.prettierignore`, content: 'dist\n' })
  expect(ledgerOf(seen.files)?.unplanned ?? []).toEqual([])
  expect((await xref($)).text).toContain('drift green')
})

test('the run log leaves the task empty for a step that implements nothing', async ($, on) => {
  const files = { ...DEMO }
  delete files[`${FEATURE}/tasks.md`]
  const seen = project(on, files)
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  seen.write(`${FEATURE}/tasks.md`, DEMO[`${FEATURE}/tasks.md`]!)
  await runTurn($)
  await seen.clock.advance(0)
  const log = seen.files[localPath(FEATURE).replace('.json', '.run.jsonl')]!
  expect(JSON.parse(log.trim().split('\n')[0]!)).toMatchObject({ phase: 'tasks', task: null })
})

test('a run that ends right after the analysis still owes its fixes, in this session or the next', async ($, on) => {
  const files = { ...DEMO, [`${FEATURE}/tasks.md`]: DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[x\]/g, '- [ ]') }
  const seen = project(on, files)
  await startSession($)
  await xref($, 'auto on 1')
  await seen.clock.advance(0)
  await runTurn($, '| C1 | Constitution | CRITICAL | … |')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('the step budget (1) is used up')
  expect(ledgerOf(seen.files).checkpoints.remediate).toBe('due')
  await startSession($)
  expect((await xref($)).text).toContain('Next Spec Kit step: The analysis found inconsistencies')
})
