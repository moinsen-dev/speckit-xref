import { expect, test } from 'claude-code/testing'

import { DEMO } from './fixtures/demo'
import { BAND, FEATURE, PANE, ROOT, endTurn, project, startSession, toText, type, xref } from './harness'

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const turn = ($: any, answer = 'Done with this step.', isAborted = false) =>
  $.turn.complete({ reason: isAborted ? 'aborted' : 'answer', answer, durationMs: 1000, isAborted, turnId: `t-${Math.random()}` })

const band = async ($: any) => toText(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).drawn())

test('/xref auto on hands the next Spec Kit step to the model, and the next one after each turn', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  expect((await xref($, 'auto on')).text).toContain('Autopilot on')
  await seen.clock.advance(0)
  const [first] = autopilotPrompts(seen)
  expect(first).toContain('[speckit-xref autopilot · step 1/25] implement: 5 of 8 tasks open; next T004.')
  expect(first).toContain('Run /speckit-implement now: invoke it through the Skill tool and carry it through.')
  expect(first).toContain('Carry the step through without asking whether to continue')
  expect(first).toContain('Current task: T004')
  expect(await band($)).toContain('auto ▶ 1/25')
  // The model ticks T004; the turn ends; the autopilot moves on by itself.
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[1]).toContain('[speckit-xref autopilot · step 2/25] implement: 4 of 8 tasks open; next T005.')
})

test('a question through the ask tool pauses the autopilot until the person answers', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'How many link requests per hour (FR-005)?' } as never)
  await turn($, 'I need one decision from you: how many link requests per hour?')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe('Autopilot waits for you: How many link requests per hour (FR-005)?')
  expect(await band($)).toContain('auto ⏸ waiting for you')
  const status = await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)
  expect(status.result).toContain('Autopilot: on, waiting: How many link requests per hour (FR-005)?')
  // The person answers; their turn ends; the autopilot goes on.
  await type($, 'Five per hour.')
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
})

test('"shall I go on?" does not stop the autopilot; a real decision does', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await turn($, 'T004 is done. Shall I go on with T005?')
  await seen.clock.advance(0)
  expect(seen.classified).toHaveLength(1)
  expect(autopilotPrompts(seen)).toHaveLength(2)
})

test('an answer that needs the person\'s decision pauses the autopilot', async ($, on) => {
  const seen = project(on, { ...DEMO }, { classify: 'needs a decision only the person can make' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await turn($, 'Should rate limiting be per email address or per IP?')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe('Autopilot waits for you: the last answer asks you something')
})

test('three steps without progress pause the run', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 3; i++) {
    await turn($)
    await seen.clock.advance(0)
  }
  expect(autopilotPrompts(seen)).toHaveLength(3)
  expect(seen.toasts.at(-1)).toContain('three steps without progress')
})

test('Esc stops the run where it stands', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await turn($, '', true)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toContain('you interrupted the turn')
})

test('the step budget ends a run; /xref auto on starts a new one', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on 2')
  await seen.clock.advance(0)
  for (const id of ['T004', 'T005']) {
    seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace(`- [ ] ${id}`, `- [x] ${id}`))
    await turn($)
    await seen.clock.advance(0)
  }
  expect(autopilotPrompts(seen)).toHaveLength(2)
  expect(seen.toasts.at(-1)).toContain('the step budget (2) is used up')
})

test('without a feature it waits for the idea, then specifies it in the person\'s own words', async ($, on) => {
  const files: Record<string, string> = {
    '.specify/memory/constitution.md': DEMO['.specify/memory/constitution.md']!,
    '.specify/integration.json': JSON.stringify({ integration: 'claude', installed_integrations: ['claude'], integration_settings: { claude: { invoke_separator: '-' } } }),
    '.claude/skills/speckit-plan/SKILL.md': '---\nname: speckit-plan\n---\n',
  }
  const seen = project(on, files)
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  expect(seen.toasts.at(-1)).toBe('Autopilot waits for you: Describe the feature you want built; your own words become the spec.')
  await type($, 'A reading list where I track books I want to read and mark them as finished.')
  await turn($, 'Got it.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain(
    'Run /speckit-specify A reading list where I track books I want to read and mark them as finished. now',
  )
})

test('once every task is checked and verified, the autopilot ends the run', async ($, on) => {
  const done = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: done })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('verify: Every task is checked: check the code against the spec.')
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(seen.toasts.at(-1)).toBe(`Autopilot done: every task of ${FEATURE} is checked and the drift is green.`)
  expect((await xref($, 'auto')).text).toBe('Autopilot off. /xref auto on [steps] starts it.')
})

test('a request that contradicts the spec stops the run for the person', async ($, on) => {
  const verdict = JSON.stringify({ score: 40, verdict: 'drift', reasons: ['password fallback'], intent_changes: [{ text: 'allow passwords as a fallback', kind: 'contradicts' }] })
  const seen = project(on, { ...DEMO }, { fork: verdict })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await turn($)
  await seen.clock.advance(10)
  expect(seen.toasts).toContain('Autopilot waits for you: your request "allow passwords as a fallback" contradicts the spec; decide in the pane')
  const before = autopilotPrompts(seen).length
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(before)
})

test('while the autopilot runs, the person\'s prompts carry the autonomy rules too', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await type($, 'Also keep the code tidy.')
  expect(seen.submitted.at(-1).context.join('\n')).toContain('Stop only for what only the person can decide')
})

test('autopilot: on in the plugin options starts every session switched on', { options: { autopilot: 'on', autopilotMaxSteps: 5 } }, async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  expect((await xref($, 'auto')).text).toBe('Autopilot on, step 0/5.')
  // Switched on is not running: the first step waits for the end of the person's first turn.
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('step 1/5')
})

test('the pane starts and stops the autopilot', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const start = await pane.find({ key: 'auto' })
  expect([start?.props.label, start?.props.hotkey]).toEqual(['Start autopilot', 'p'])
  expect(toText(await pane.drawn())).toContain('Autooff')
  await pane.press({ key: 'auto' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
  expect(toText(await pane.drawn())).toContain('Autoon · step 1/25')
  expect(await pane.find({ key: 'auto' })).toBeUndefined()
  await pane.press({ key: 'auto-stop' })
  expect((await xref($, 'auto')).text).toBe('Autopilot off. /xref auto on [steps] starts it.')
  await turn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(1)
})

test('Resume in the pane goes on after the autopilot asked the person', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await $.tool.call({ tool: 'mcp__speckit-xref__ask', question: 'Per email or per IP?' } as never)
  await turn($)
  await seen.clock.advance(0)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('Autoon · waiting for you: Per email or per IP?')
  expect((await pane.find({ key: 'auto-resume' }))?.props.hotkey).toBe('r')
  await pane.press({ key: 'auto-resume' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(2)
  expect(await pane.find({ key: 'auto-resume' })).toBeUndefined()
})

test('Resume after a spent budget starts a new one', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on 1')
  await seen.clock.advance(0)
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await turn($)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('the step budget (1) is used up')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'auto-resume' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('[speckit-xref autopilot · step 1/1] implement: 4 of 8 tasks open; next T005.')
})

test('before Spec Kit is set up, the pane offers the autopilot too', async ($, on) => {
  project(on, { 'README.md': '# app\n' })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ key: 'auto' }))?.props.label).toBe('Start autopilot')
    await pane.unmount()
  }
})

test('a stray speckit skill is no Claude Code integration: the autopilot installs the real one first', async ($, on) => {
  const files: Record<string, string> = { ...DEMO }
  for (const key of Object.keys(files)) if (key.startsWith('.claude/skills/') && !key.includes('speckit-clarify')) delete files[key]
  const seen = project(on, files)
  await startSession($)
  const status = await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)
  expect(status.result).toContain('Claude Code integration missing')
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain("Install Spec Kit's Claude Code integration now: run `uvx --from 'specify-cli>=1.1,<2' specify integration install claude`.")
})

test('/xref pane brings the pane forward and names its keys', async ($, on) => {
  project(on, { ...DEMO })
  await startSession($)
  expect((await xref($, 'pane')).text).toBe('Spec X-Ref pane in front. Keys: p start/stop autopilot · r resume · c check · a accept edits · Esc back to the prompt.')
})
