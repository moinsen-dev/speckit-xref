import { expect, test } from 'claude-code/testing'

import { DEMO } from './fixtures/demo'
import { BAND, COMPOSE, FEATURE, PANE, ROOT, endTurn, ledgerOf, project, startSession, toText, type, xref } from './harness'

const INTENT_REPLY = JSON.stringify({
  score: 45,
  verdict: 'drift',
  reasons: ['A password fallback was built although the spec rules passwords out'],
  intent_changes: [{ text: 'allow passwords as a fallback', kind: 'contradicts' }],
})

test('follows the active feature and registers /xref, its tools and the pane', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  expect(seen.commands).toEqual(['xref'])
  expect(seen.tools).toEqual(['focus', 'where', 'status', 'ask', 'link'])
  expect(seen.opened).toEqual(['speckit-xref'])
  const status = await xref($)
  expect(status.text).toMatch(new RegExp(`^${FEATURE} · tasks 3/8 · FR covered 4/5 · drift green`))
  expect(status.text).toContain('Next: T005 Implement POST /auth/link handler in src/auth/request-link.ts (FR-001) | T006')
  expect(status.text).toContain('Current task: T004 [US1]')
})

test('without a feature it stays quiet: no section, no pane', async ($, on) => {
  const seen = project(on, { 'README.md': '# app\n' })
  await startSession($)
  expect(seen.opened).toEqual([])
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.id)).toEqual(['intro'])
  expect((await xref($)).text).toBe('This folder is empty: a new app, project or problem can start here with Spec Kit. Tell me what you want to build (an app, a project, a problem): I set Spec Kit up for it and write the spec in your words.')
})

test('puts the spec into the system prompt and keeps it stable while tasks change', async ($, on) => {
  project(on, { ...DEMO })
  await startSession($)
  const first = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'speckit-xref:spec')
  expect(first?.scope).toBe('session')
  expect(first?.text).toContain('Magic Link Login')
  expect(first?.text).toContain('- Email addresses MUST NOT be written to logs.')
  await $.tool.call({ tool: 'mcp__speckit-xref__focus', task: 'T006' } as never)
  const second = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'speckit-xref:spec')
  expect(second?.text).toBe(first?.text)
})

test('the person\'s prompt is logged as intent and carries the current task', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await type($, 'Please also allow passwords as a fallback')
  const entered = seen.submitted.at(-1)
  expect(entered.context.at(-1)).toContain('Current task: T004')
  await endTurn($)
  expect(ledgerOf(seen.files).intents.map((i: any) => i.text)).toEqual(['Please also allow passwords as a fallback'])
})

test('books a planned edit to its task and flags an unplanned one to the model and the person', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  const planned = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/callback.ts`, old_string: 'a', new_string: 'b' })
  expect(planned.context?.[0]).toContain('belongs to T006')
  const unplanned = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/ui/theme.ts`, content: 'export const dark = true\n' })
  expect(unplanned.context?.[0]).toContain('src/ui/theme.ts is not planned for the current task T006')
  expect(seen.toasts.at(-1)).toContain('Spec drift yellow')
  await endTurn($)
  const ledger = ledgerOf(seen.files)
  expect(ledger.tasks.T006.touched).toEqual(['src/auth/callback.ts'])
  expect(ledger.unplanned.map((u: any) => u.file)).toEqual(['src/ui/theme.ts'])
  expect(ledger.summary.level).toBe('yellow')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(toText(await band.drawn())).toContain('xref T006 · tasks 3/8 · FR 4/5 · drift yellow (1)')
})

test('linking the file through the tool clears the drift', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/ui/theme.ts`, content: 'x' })
  const answer = await $.tool.call({ tool: 'mcp__speckit-xref__link', file: 'src/ui/theme.ts', id: 'FR-004' } as never)
  expect(answer.result).toBe('Linked src/ui/theme.ts to FR-004.')
  const where = await $.tool.call({ tool: 'mcp__speckit-xref__where', file: `${ROOT}/src/ui/theme.ts` } as never)
  expect(where.result).toContain('Requirements: FR-004')
  expect(ledgerOf(seen.files).summary.level).toBe('green')
})

test('strict mode refuses an unplanned edit and names the way forward', { options: { mode: 'strict' } }, async ($, on) => {
  project(on, { ...DEMO })
  await startSession($)
  const refused = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/ui/theme.ts`, content: 'x' })
  expect(refused.deny).toContain('speckit-xref (strict): src/ui/theme.ts is not planned for T004')
  expect(refused.deny).toContain('mcp__speckit-xref__link')
  const planned = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/auth/token.ts`, content: 'x' })
  expect(planned.deny).toBeUndefined()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toContain('Strict mode')
})

test('anchors in the code count as coverage, and one to a missing requirement is drift', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  const where = await $.tool.call({ tool: 'mcp__speckit-xref__where', file: 'src/auth/token.ts' } as never)
  expect(where.result).toContain('001-magic-link-login/FR-002 (line 1)')
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/auth/request-link.ts`, content: '// @spec 001-magic-link-login/FR-009\n' })
  await endTurn($)
  expect(ledgerOf(seen.files).summary.level).toBe('yellow')
  expect((await xref($)).text).toContain('anchors 001-magic-link-login/FR-009, which the spec no longer has')
})

test('without ripgrep, git grep finds anchors in files not committed yet', async ($, on) => {
  const files = { ...DEMO, 'src/auth/callback.ts': '// @spec 001-magic-link-login/FR-003\n' }
  const seen = project(on, files, { noRipgrep: true, untracked: ['src/auth/callback.ts'] })
  await startSession($)
  expect(seen.ran.some(argv => argv[0] === 'git' && argv[1] === 'grep')).toBe(true)
  const where = await $.tool.call({ tool: 'mcp__speckit-xref__where', file: 'src/auth/callback.ts' } as never)
  expect(where.result).toContain('001-magic-link-login/FR-003 (line 1)')
})

test('after a turn that wrote, the intent check runs on the clock and its verdict reaches band, pane and buttons', async ($, on) => {
  const seen = project(on, { ...DEMO }, { fork: INTENT_REPLY })
  await startSession($)
  await type($, 'Please also allow passwords as a fallback')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($)
  await seen.clock.advance(10)
  expect(seen.forks).toHaveLength(1)
  expect(seen.forks[0]).toContain('Changed files: src/auth/token.ts')
  expect(seen.forks[0]).toContain('+export const ttl = 15 * 60')
  expect(seen.toasts.at(-1)).toContain('Spec drift red')
  const ledger = ledgerOf(seen.files)
  expect(ledger.semantic.score).toBe(45)
  expect(ledger.intents[0].status).toBe('contradicts')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const text = toText(await pane.drawn())
    expect(text).toContain('Magic Link Login')
    expect(text).toContain('Drift● red · intent 45/100')
    expect(text).toContain('User asked: "allow passwords as a fallback", which contradicts the spec')
    expect(await pane.find({ key: 'spec-0' })).toBeDefined()
    await pane.unmount()
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'spec-0' })
  expect(seen.commandsRun.at(-1)).toMatch(/^\/speckit-clarify The user asked during implementation: "allow passwords as a fallback"/)
  expect(ledgerOf(seen.files).intents[0].status).toBe('resolved')
})

test('"As task" appends a remediation task to tasks.md', async ($, on) => {
  const seen = project(on, { ...DEMO }, { fork: INTENT_REPLY })
  await startSession($)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($)
  await seen.clock.advance(10)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'task-0' })
  expect(seen.files[`${FEATURE}/tasks.md`]).toContain('- [ ] T009 [Drift] allow passwords as a fallback')
  expect(seen.toasts.at(-1)).toBe(`Added T009 to ${FEATURE}/tasks.md.`)
})

test('no intent check after a turn that only talked', async ($, on) => {
  const seen = project(on, { ...DEMO }, { fork: INTENT_REPLY })
  await startSession($)
  await endTurn($)
  await seen.clock.advance(10)
  expect(seen.forks).toHaveLength(0)
})

test('/xref map stores the model\'s requirement-to-task map in xref.json', async ($, on) => {
  const seen = project(on, { ...DEMO }, { complete: 'Here you go: {"FR-005": ["T005"], "FR-002": ["T004", "T007"], "FR-999": ["T001"]}' })
  await startSession($)
  const answer = await xref($, 'map')
  expect(answer.text).toBe('Mapped 2 requirements to tasks; 5/5 FRs covered.')
  expect(seen.completes[0]).toContain('FR-005: System MUST rate-limit link requests')
  const ledger = ledgerOf(seen.files)
  expect(ledger.requirements['FR-002'].tasks).toEqual(['T004', 'T007'])
  expect(ledger.requirements['FR-999']).toBeUndefined()
})

test('a change to tasks.md outside the session reaches the band within one refresh', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  // The person ticks T004 in their editor: the file and its time change, no tool call says so.
  seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]!.replace('- [ ] T004', '- [x] T004'))
  await seen.clock.advance(4000)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(toText(await band.drawn())).toContain('xref T005 · tasks 4/8')
})

test('with the intent check switched off, a turn that wrote asks no model', { options: { driftCheck: 'off' } }, async ($, on) => {
  const seen = project(on, { ...DEMO }, { fork: INTENT_REPLY })
  await startSession($)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($)
  await seen.clock.advance(10)
  expect(seen.forks).toHaveLength(0)
  expect(ledgerOf(seen.files).summary.level).toBe('green')
})

test('a request the person already sent to the spec stays settled when the next check quotes it again', async ($, on) => {
  const seen = project(on, { ...DEMO }, { fork: INTENT_REPLY })
  await startSession($)
  await type($, 'Please also allow passwords as a fallback')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($)
  await seen.clock.advance(10)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'spec-0' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/token.ts`, old_string: 'b', new_string: 'c' })
  await endTurn($)
  await seen.clock.advance(10)
  expect(seen.forks).toHaveLength(2)
  const ledger = ledgerOf(seen.files)
  expect(ledger.semantic.changes).toEqual([])
  expect(ledger.intents[0].status).toBe('resolved')
})

test('/xref check before the first turn falls back to one completion fed by the intent log', async ($, on) => {
  const seen = project(on, { ...DEMO }, { forkReason: 'nothing-to-fork', complete: INTENT_REPLY })
  await startSession($)
  await type($, 'Please also allow passwords as a fallback')
  const answer = await xref($, 'check')
  expect(answer.text).toBe('Intent check 45/100 (drift): A password fallback was built although the spec rules passwords out')
  expect(seen.forks).toHaveLength(1)
  expect(seen.completes[0]).toContain('What the user said in this session, oldest first:\n- Please also allow passwords as a fallback')
  expect(seen.completes[0]).toContain('Changed files: src/auth/token.ts')
})

test('the status tool tells the model where the project stands and what comes next', async ($, on) => {
  project(on, { ...DEMO, '.specify/integration.json': JSON.stringify({ integration: 'claude', integration_settings: { claude: { invoke_separator: '-' } } }), '.specify/extensions/xref/extension.yml': 'x' })
  await startSession($)
  const status = await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)
  expect(status.result).toContain('Spec Kit CLI: not installed; runs through uvx')
  expect(status.result).toContain('Spec Kit: set up (1.1.2) · Claude Code integration yes, commands as /speckit-plan · extensions: xref')
  expect(status.result).toContain('Autopilot: off (/xref auto on)')
  expect(status.result).toContain('Constitution: 3 principles, 3 MUST rules')
  expect(status.result).toContain('Artifacts: spec.md yes · plan.md yes · tasks.md 3/8 done · FR covered 4/5 · drift green')
  expect(status.result).toContain('Phase: implement. 5 of 8 tasks open; next T004.')
  expect(status.result).toContain('Next: /speckit-implement')
  expect(status.result).toContain('- FR-005 still marked NEEDS CLARIFICATION (/speckit-clarify).')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('Next/speckit-implement · 5 of 8 tasks open; next T004.')
})

test('a project on the commands layout gets dotted commands', async ($, on) => {
  project(on, { ...DEMO, '.specify/integration.json': JSON.stringify({ integration: 'copilot', integration_settings: { copilot: { invoke_separator: '.' } } }) })
  await startSession($)
  expect((await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)).result).toContain('Next: /speckit.implement')
})

test('a plan written outside the session moves the next step on', async ($, on) => {
  const files: Record<string, string> = { ...DEMO }
  delete files[`${FEATURE}/plan.md`]
  delete files[`${FEATURE}/tasks.md`]
  const seen = project(on, files)
  await startSession($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('FR-005 still marked NEEDS CLARIFICATION; settle them before planning.')
  seen.write(`${FEATURE}/plan.md`, '# Plan\n')
  await seen.clock.advance(4000)
  // The snapshot is $.state the pane reads, so the drawing follows without a remount.
  expect(toText(await pane.drawn())).toContain('Next/speckit-tasks · The plan is written; tasks.md is missing.')
})

test('in a repository without Spec Kit the pane points to the setup skill', async ($, on) => {
  project(on, { 'README.md': '# app\n' })
  await startSession($)
  const status = await $.tool.call({ tool: 'mcp__speckit-xref__status' } as never)
  expect(status.result).toContain('Phase: setup. This folder is empty: a new app, project or problem can start here with Spec Kit.')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('[Start from an idea]')
})
