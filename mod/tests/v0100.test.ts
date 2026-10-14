import { expect, test } from 'claude-code/testing'

import { parseAnswer, parseVerdict, personOnly } from '../hooks/deputy'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.10.0: the deputy. Between the steps the autopilot reads the work the way the person would: it sends a step on, back
// with a list, or to the person; it answers Claude's questions for the person and says so; it never approves a gate,
// and what only the person decides stays theirs, in code.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const tick = (seen: any, task: string) => seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace(`- [ ] ${task}`, `- [x] ${task}`))

test('a verdict and an answer are read strictly; what only the person decides stays theirs whatever the model says', () => {
  expect(parseVerdict('{"verdict":"go","note":"Watch the empty state.","rework":[],"question":"","recommendation":"","profile":[]}')).toMatchObject({ verdict: 'go', note: 'Watch the empty state.' })
  expect(parseVerdict('Sure. {"verdict":"rework","rework":["T004 has no test for FR-002"]}')?.rework).toEqual(['T004 has no test for FR-002'])
  // A send-back without a list or a question without one is no verdict to act on.
  expect(parseVerdict('{"verdict":"rework","rework":[]}')?.verdict).toBe('go')
  expect(parseVerdict('{"verdict":"ask"}')?.verdict).toBe('go')
  expect(parseVerdict('no json here')).toBeNull()
  expect(parseAnswer('{"decided":true,"answer":"Per email","why":"FR-005 counts per address"}', 'Per email or per IP?')).toEqual({ decided: true, answer: 'Per email', why: 'FR-005 counts per address' })
  // Found live: a hand check or a measurement is the person's part (Fund 40), and so are money, keys and releases.
  for (const q of ['No simulator here for the native smoke test (T004): will you run it?', 'Offen bleibt T086, die Messung der Quote: soll ich sie als erledigt markieren?', 'Soll ich den Stripe-Zahlungslink anlegen?', 'Which API key should I use?', 'Shall I publish the release?']) {
    expect(personOnly(q)).toBe(true)
    expect(parseAnswer('{"decided":true,"answer":"Yes, mark it done","why":"close enough"}', q)?.decided).toBe(false)
  }
  expect(personOnly('Should the empty list show a hint or stay blank?')).toBe(false)
})

test('the deputy sends a step back with its list; the rework goes first, and twice back makes it the person\'s call', { options: { orchestrate: 'off' } }, async ($, on) => {
  const rework = JSON.stringify({ verdict: 'rework', rework: ['T004 checks a token but FR-002 asks for expiry: add the expiry and its test'], note: '', question: '', recommendation: '', profile: [] })
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, replies: [rework, rework, rework] })
  const asked = seen.completes
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('] implement:')
  tick(seen, 'T004')
  await runTurn($, 'T004 done: tokens are hashed.')
  await seen.clock.advance(0)
  // The review read the report and the tests.
  expect(asked.at(-1)).toContain('T004 done: tokens are hashed.')
  expect(asked.at(-1)).toContain('## Test run\npassed')
  const back = autopilotPrompts(seen).at(-1)!
  expect(back).toContain('] rework: The deputy sent the implement step back')
  expect(back).toContain('FR-002 asks for expiry')
  await runTurn($, 'Expiry added.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('] rework:')
  await runTurn($, 'Expiry added again.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('the deputy sent the implement step back 2 times')
  const log = seen.files[`.specify/xref/local/${FEATURE.slice(6)}.run.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(log.filter((r: any) => r.phase === 'deputy').map((r: any) => r.outcome.split(':')[0])).toEqual(['sent back', 'sent back', 'sent back 2 times'])
})

test("the deputy's word on a step travels with the next one; a question only the person can answer pauses the run with the deputy's recommendation", { options: { orchestrate: 'off' } }, async ($, on) => {
  const go = JSON.stringify({ verdict: 'go', note: 'Keep the link single-use when you add the handler.', rework: [], question: '', recommendation: '', profile: ['Prefers German UI texts'] })
  const ask = JSON.stringify({ verdict: 'ask', question: 'The spec says nothing about rate limits per IP: limit them?', recommendation: 'Yes, 5 per hour, as for email', rework: [], note: '', profile: [] })
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, replies: [go, ask] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  tick(seen, 'T004')
  await runTurn($, 'T004 done.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain("The person's deputy on the last step: Keep the link single-use")
  // The profile is learned where the person's prompts are kept: local.
  expect(seen.files['.specify/xref/local/person.md']).toContain('- Prefers German UI texts')
  tick(seen, 'T005')
  await runTurn($, 'T005 done.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('The spec says nothing about rate limits per IP: limit them? (the deputy recommends: Yes, 5 per hour, as for email)')
})

test("the deputy answers Claude's question in the same turn and shows it as decided for the person; a permission and a hand check still go to the person", { options: { orchestrate: 'off' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, {
    tests: { exits: [0] },
    replies: [JSON.stringify({ decided: true, answer: 'Per email address', why: 'FR-005 counts link requests per address' }), JSON.stringify({ decided: true, answer: 'Mark it done', why: 'the unit test covers it' })],
  })
  const asked = seen.completes
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const answer = await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Rate-limit per email or per IP (FR-005)?' } as never)
  expect(String(answer.result)).toContain("The person's deputy answered: Per email address (FR-005 counts link requests per address)")
  const decision = ledgerOf(seen.files).decisions.at(-1)
  expect(decision).toMatchObject({ answer: 'Per email address', by: 'deputy' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('For you')
  expect(await pane.find({ key: `redecide-${decision.id}` })).toBeDefined()
  // A permission the rails stopped is never the deputy's: no call to it.
  const calls = asked.length
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Push the feature branch?', allow: 'pushing' } as never)
  expect(asked.length).toBe(calls)
  // A hand check stays the person's part even when the model would decide it (Fund 40).
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'No simulator here for the native smoke test (T004): will you run it?' } as never)
  await runTurn($, 'T004 left open: no simulator here.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: No simulator here for the native smoke test')
  expect(ledgerOf(seen.files).decisions.filter((d: any) => d.by === 'deputy')).toHaveLength(1)
})

test('deputy off: no review and no answer, the autopilot as before', { options: { orchestrate: 'off', deputy: 'off' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { tests: { exits: [0] }, replies: [JSON.stringify({ verdict: 'rework', rework: ['x'] })] })
  const asked = seen.completes
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  tick(seen, 'T004')
  await runTurn($, 'T004 done.')
  await seen.clock.advance(0)
  expect(asked).toHaveLength(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('] implement:')
})
