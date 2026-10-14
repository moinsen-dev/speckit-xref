import { expect, test } from 'claude-code/testing'

import { DEMO } from './fixtures/demo'
import { PANE, ROOT, project } from './harness'

// 0.9.1, found live: the desktop app hosts a session that is not interactive but draws a pane and a band. The Stop
// hook hands each step over at the end of a turn; a press outside a turn (Approve, Resume) had no turn to end, so the
// run waited until the person typed "weiter". Now the press starts the step.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

test('found live: in the desktop app a press outside a turn starts the next step; inside a turn the Stop hook still chains them', { options: { autopilot: 'on', orchestrate: 'off' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { surfaces: ['desktop'] })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  // Inside a turn the step rides the Stop hook as before.
  await $.turn.start({ text: 'Go on with the feature', turnId: 't0' })
  const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Ready.' } as never)
  expect(first.block).toContain('step 1/25] implement')
  await $.turn.complete({ reason: 'answer', answer: 'Ready.', durationMs: 1000, isAborted: false, turnId: 't0' })
  expect(autopilotPrompts(seen)).toHaveLength(0)
  // The step's turn ends with a question: the run waits for the person.
  await $.turn.start({ text: first.block, turnId: 't1' })
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Per email or per IP?' } as never)
  const stop = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Per email or per IP?' } as never)
  expect(stop.block).toBeUndefined()
  await $.turn.complete({ reason: 'answer', answer: 'Per email or per IP?', durationMs: 1000, isAborted: false, turnId: 't1' })
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you')
  // Resume in the pane, between turns: the step starts at once, and only once.
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'auto-resume' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(autopilotPrompts(seen)[0]).toContain('step 2/25]')
  await pane.press({ key: 'auto-resume' }).catch(() => undefined)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
})
