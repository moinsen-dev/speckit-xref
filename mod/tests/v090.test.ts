import { expect, test } from 'claude-code/testing'

import { treeOf, verifyKey } from '../hooks/brief'
import { platformsFromPlan } from '../hooks/accept'
import { DESIGNER, tryTools } from '../hooks/orchestrate'
import { DESIGN_PASS_RULES, MAX_DESIGN_REVIEWS, designRounds, isDesignPhase, parsePolish } from '../hooks/polish'
import { emptyLedger } from '../hooks/xref'
import { nextStep, phaseStrip, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom, specFingerprint } from '../hooks/rules'
import type { Ledger, Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.9.0: Polish. A done feature that works is lifted to its platform's best look: a design lead sets the direction with
// sample screens, the person approves it there, the implementer builds the design pass, the design lead reviews fresh
// shots of every screen (three rounds at most).

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))
const SPEC = parseSpec(DEMO[`${FEATURE}/spec.md`]!)
const PLAN = (DEMO[`${FEATURE}/plan.md`] ?? '').replace('**Testing**: vitest', '**Testing**: vitest\n**Project Type**: mobile app\n**Target Platform**: iOS 26+, Android, web')
const DONE = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
const PASS = (open: boolean) => `${DONE}\n## Phase 9: Design pass\n\n- [x] T100 Shared look: theme, type, components in \`src/ui/theme.ts\`\n- [${open ? ' ' : 'x'}] T101 Moment screen in \`app/index.tsx\`\n`
const POLISH = '# Design pass\n\n## Direction\n\nCalm glass over warm photos, native controls, large titles.\n\n## Screens\n\n- Moment: …\n\n## Samples\n\n- Moment: before → after\n\n## Rounds\n'

function snapOf(tasksMd: string, extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(tasksMd)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: SPEC, tasks, constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
    commandStyle: 'skills', rules: rulesFrom(null), realTests: [], planFingerprint: 'p', testCommand: 'npm test', branch: null,
    phase: tasks.find(t => !t.done)?.phase ?? null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge', 'analyze'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: true, platforms: platformsFromPlan(PLAN), ...extra,
  } as unknown as Snapshot
}
const verifiedOf = (snap: Snapshot): Ledger => {
  const key = verifyKey(snap, tasksFingerprint(snap.tasks))
  const work = tasksFingerprint(snap.tasks.filter(t => !isDesignPhase(t.phase)))
  return { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: specFingerprint(SPEC), converge: work, verify: key, polishWanted: 'yes' } }
}
const FLOW = { review: 'none' as const, orchestrate: true, acceptance: false }

test("Spec Kit's own last phase is no design pass; a design pass and its reviews are", () => {
  expect(isDesignPhase('Phase 6: Polish & Cross-Cutting Concerns')).toBe(false)
  expect(isDesignPhase('Phase 9: Design pass')).toBe(true)
  expect(isDesignPhase('Phase 10: Design review 1')).toBe(true)
  expect(designRounds(parseTasks(`${PASS(false)}\n## Phase 10: Design review 1\n\n- [x] T102 Spacing in \`app/index.tsx\`\n`))).toBe(1)
  // A stock Polish phase stays an ordinary implement step: no design gate, no design rules.
  const stock = snapOf(`${DONE}\n## Phase 6: Polish & Cross-Cutting Concerns\n\n- [ ] T090 Error messages in \`src/ui/errors.ts\`\n`, { polish: parsePolish(POLISH) })
  const ledger: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: specFingerprint(SPEC) } }
  const step = nextStep(stock, ledger, null, FLOW)
  expect(step.phase).toBe('implement')
  expect(step.delegate?.brief).not.toContain(DESIGN_PASS_RULES)
})

test('Polish on a done feature: the design lead (Opus) sets the direction with samples; without a user interface there is none', () => {
  const done = snapOf(DONE)
  const step = nextStep(done, verifiedOf(done), null, FLOW)
  expect(step.phase).toBe('polish')
  expect(step.consumes).toBe(true)
  expect(step.delegate).toMatchObject({ agent: DESIGNER, model: 'opus' })
  expect(step.delegate?.brief).toContain('## Phase N: Design pass')
  expect(step.delegate?.brief).toContain('Before any code')
  expect(step.prompt).toContain('subagent_type "speckit-xref:designer"')
  expect(nextStep(snapOf(DONE, { ui: false }), verifiedOf(done), null, FLOW).phase).toBe('done')
  // Not asked for: done stays done.
  const asked = verifiedOf(done)
  delete asked.checkpoints.polishWanted
  expect(nextStep(done, asked, null, FLOW).phase).toBe('done')
  // Asked in words after done: the same step.
  expect(nextStep(done, asked, null, { ...FLOW, next: { kind: 'polish', text: 'make it beautiful' } }).phase).toBe('polish')
  // Not orchestrated: the session itself, with the design lead's prompt.
  expect(nextStep(done, verifiedOf(done), null, { ...FLOW, orchestrate: false }).prompt).toContain('You are the design lead')
})

test("the design pass waits for the person's yes at the samples, then is built as a design pass (never by Haiku)", () => {
  const pass = snapOf(PASS(true), { polish: parsePolish(POLISH) })
  const ledger: Ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { analyze: specFingerprint(SPEC), polishWanted: 'yes' } }
  const review = nextStep(pass, ledger, null, FLOW)
  expect([review.phase, review.approve?.key]).toEqual(['review', 'polish'])
  expect(review.needsUser).toContain('Approve direction')
  expect(review.why).toContain('Calm glass over warm photos')
  expect(phaseStrip(pass, review)).toContain('▶polish')
  const approved = { ...ledger, approvals: { ...ledger.approvals, polish: pass.polish!.fingerprint } }
  const build = nextStep(pass, approved, null, FLOW)
  expect(build.phase).toBe('implement')
  expect(build.delegate?.brief).toContain(DESIGN_PASS_RULES)
  // Only docs and configuration in the open task would be Haiku's: not in a design pass.
  const docsOnly = snapOf(`${DONE}\n## Phase 9: Design pass\n\n- [ ] T100 Direction in \`DESIGN.md\` and \`app.json\`\n`, { polish: parsePolish(POLISH) })
  expect(nextStep(docsOnly, approved, null, FLOW).delegate?.model).toBe('sonnet')
  // A review round writes under Rounds: the approval holds.
  expect(parsePolish(`${POLISH}\n### Round 1\n\n- Moment: OK\n`).fingerprint).toBe(pass.polish!.fingerprint)
  expect(parsePolish(POLISH.replace('Calm glass', 'Bold colour')).fingerprint).not.toBe(pass.polish!.fingerprint)
})

test('a built design pass is reviewed from fresh shots until a round finds nothing, three rounds at most; its record changes nothing verified', () => {
  const built = snapOf(PASS(false), { polish: parsePolish(POLISH) })
  const ledger = verifiedOf(built)
  ledger.approvals.polish = built.polish!.fingerprint
  // The design pass started no new converge.
  const first = nextStep(built, ledger, null, FLOW)
  expect(first.phase).toBe('polish')
  expect(first.approve?.key).toBe('polishCheck')
  expect(first.delegate).toMatchObject({ agent: DESIGNER, model: 'opus' })
  expect(first.delegate?.brief).toContain('Review round 1 of 3')
  expect(first.delegate?.brief).toContain('Take a fresh shot of every screen')
  // The round found nothing: the checkpoint holds, done.
  const reviewed = { ...ledger, checkpoints: { ...ledger.checkpoints, polishCheck: first.approve!.value } }
  expect(nextStep(built, reviewed, null, FLOW).phase).toBe('done')
  // Three rounds that each found something: no fourth.
  const rounds = [1, 2, 3].map(n => `\n## Phase ${9 + n}: Design review ${n}\n\n- [x] T${101 + n} Fix ${n} in \`app/index.tsx\`\n`).join('')
  const third = snapOf(PASS(false) + rounds, { polish: parsePolish(POLISH) })
  const after = verifiedOf(third)
  after.approvals.polish = third.polish!.fingerprint
  expect(designRounds(third.tasks)).toBe(MAX_DESIGN_REVIEWS)
  expect(nextStep(third, after, null, FLOW).phase).toBe('done')
  // The record and the shots are no code.
  const base = '100644 blob a1\tapp/index.tsx'
  expect(treeOf(`${base}\nh1 ${FEATURE}/polish.md\nh2 ${FEATURE}/polish/round-1/moment.png`)).toBe(treeOf(base))
})

test('a design pass brings its own verify rounds: the cap does not close it early', () => {
  const pass = snapOf(PASS(false), { polish: parsePolish(POLISH), tree: treeOf('b') })
  const ledger = verifiedOf(snapOf(PASS(false)))
  ledger.approvals.polish = pass.polish!.fingerprint
  const step = nextStep(pass, ledger, null, { ...FLOW, verifies: 4 })
  expect(step.phase).toBe('verify')
  delete ledger.checkpoints.polishWanted
  expect(nextStep(pass, ledger, null, { ...FLOW, verifies: 4 }).approve?.key).toBe('done')
})

test('in a console without the simulator tool, iOS runs through simctl, and taps only with Maestro', () => {
  const tools = tryTools(snapOf(DONE))
  expect(tools).toContain('xcrun simctl io <device> screenshot <file>')
  expect(tools).toContain('Without Maestro you can only look')
})

test('live: Polish in the pane hands the direction to the design lead; the approval opens the design pass; other work clears the wish', { options: { userTest: 'off' } }, async ($, on) => {
  const spawned: any[] = []
  on('agent.spawn', ($: any, e: any) => {
    spawned.push(e)
    return { model: e.model, agentId: 'agent-9' }
  })
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 4 && !seen.toasts.some(t => t.startsWith('Autopilot done:')); i++) {
    await runTurn($)
    await seen.clock.advance(0)
  }
  expect(seen.toasts.some(t => t.startsWith('Autopilot done:'))).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'next-polish' }))?.props.label).toBe('Polish')
  await pane.press({ key: 'next-polish' })
  await seen.clock.advance(0)
  expect(seen.toasts.some(t => t.startsWith('Polish: a design lead sets the direction'))).toBe(true)
  const relay = autopilotPrompts(seen).at(-1)!
  expect(relay).toContain('] polish:')
  expect(relay).toContain('subagent_type "speckit-xref:designer"')
  await $.agent.spawn({ subagentType: 'speckit-xref:designer', prompt: 'Carry out your brief.', description: 'x' } as never)
  expect(spawned.at(-1)).toMatchObject({ model: 'opus', background: false })
  expect(spawned.at(-1).prompt).toContain(`${FEATURE}/polish.md`)
  // The design lead wrote the direction, the tasks and the samples.
  seen.write(`${FEATURE}/polish.md`, POLISH)
  seen.write(`${FEATURE}/tasks.md`, PASS(true))
  await runTurn($, 'Direction set; Moment built as a sample.')
  await seen.clock.advance(0)
  expect(toText(await pane.drawn())).toContain('The design direction is set')
  expect(await pane.find({ key: 'polish-later' })).toBeDefined()
  expect((await xref($, 'approve')).text).toContain('polish')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('] implement:')
})

test('live: other work at the design direction puts the design pass aside', { options: { userTest: 'off' } }, async ($, on) => {
  on('agent.spawn', ($: any, e: any) => ({ model: e.model, agentId: 'agent-9' }))
  const seen = project(on, { ...DEMO, [`${FEATURE}/plan.md`]: PLAN, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  for (let i = 0; i < 4 && !seen.toasts.some(t => t.startsWith('Autopilot done:')); i++) {
    await runTurn($)
    await seen.clock.advance(0)
  }
  await xref($, 'polish')
  await seen.clock.advance(0)
  expect(ledgerOf(seen.files).checkpoints?.polishWanted).toBe('yes')
  seen.write(`${FEATURE}/polish.md`, POLISH)
  await runTurn($, 'Direction set.')
  await seen.clock.advance(0)
  expect((await xref($, 'next feature Add a history screen')).text).toContain('a new feature')
  expect(ledgerOf(seen.files).checkpoints?.polishWanted).toBeUndefined()
})
