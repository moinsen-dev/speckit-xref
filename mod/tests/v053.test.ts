import { expect, test } from 'claude-code/testing'

import { treeOf } from '../hooks/brief'
import { expandIds, parsePrdReview, parseRoadmap, prdCoverage, prdFingerprint, prdSections, prdSourceOf, roadmapItemOf, roadmapSpecify } from '../hooks/prd'
import { emptyLedger, forkPrompt } from '../hooks/xref'
import { MAX_VERIFIES, VERIFY_RULE, nextStep, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { rulesFrom } from '../hooks/rules'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, ROOT, ledgerOf, project, runTurn, startSession, toText, type, xref } from './harness'

// 0.5.3: a project can start from a PRD (imported, reviewed, cut into a roadmap the person approves, each feature
// carrying the PRD's ids), and verify sorts what it finds by weight and stops asking after two rounds.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const PRD_MD = `# Product Requirements Document

## 1 Vision
A show people want to play twice.

## 5 Kleinster spielbarer Kern
P0 is one short show.

**F01 Einstieg:** Testers confirm they are adults.

### 5 1 Ablauf
Three rounds and a finale.

## 6 Show Dramaturgie
The stage.
`
const REVIEW = `# PRD Review: Show

**Recommendation**: build

## Blocking decisions (before the first feature)
- D03 AI provider: recommend a provider with EU hosting
- D05 Tester login: recommend invite codes

## Contradictions
- none
`
const ROADMAP = `# Roadmap: Show

**Source**: .specify/memory/prd.md

## 1. Solo core
**Phase**: P0
**Scope**: US01–US03, F01, AC01–AC02
**Sections**: §5
**Gate before**: none
**Spec**: One short solo show with six to eight AI characters,
  three rounds and a finale, on iOS, Android and the web.

## 2. Solo beta
**Phase**: P1
**Scope**: US07, F08
**Sections**: §6
**Gate before**: G1 – 40 testers, 35 % replay
**Spec**: Thirty characters and voluntary coaching.
`

/** An empty folder with Spec Kit set up for Claude and the person's PRD beside it. */
function withPrd(name = 'PRD_Show.md'): Record<string, string> {
  return {
    'README.md': '# show\n',
    [name]: PRD_MD,
    '.specify/memory/constitution.md': '### [PRINCIPLE_1_NAME]\n',
    '.specify/integration.json': JSON.stringify({ integration: 'claude', integration_settings: { claude: { invoke_separator: '-' } } }),
    '.claude/skills/speckit-plan/SKILL.md': '---\nname: speckit-plan\n---\n',
    '.claude/skills/speckit-specify/SKILL.md': '---\nname: speckit-specify\n---\n',
  }
}

test('the PRD\'s files: its name, its ranges of ids, the roadmap, the review, its numbered sections, its ids in a spec', () => {
  expect(prdSourceOf(['README.md', 'PRD_Show.docx', 'PRD_Show.md', 'notes.md'])).toBe('PRD_Show.md')
  expect(prdSourceOf(['product-requirements.md'])).toBe('product-requirements.md')
  // Markdown only: a Word file is no PRD source.
  expect(prdSourceOf(['PRD_Show.docx'])).toBe(null)
  expect(prdSourceOf(['README.md', 'approach.md'])).toBe(null)
  expect(expandIds('US01–US03, F01, AC01-AC02, G1')).toEqual(['US01', 'US02', 'US03', 'F01', 'AC01', 'AC02', 'G1'])
  const items = parseRoadmap(ROADMAP)
  expect(items.map(i => [i.title, i.phase, i.gate, i.sections])).toEqual([
    ['Solo core', 'P0', null, ['5']],
    ['Solo beta', 'P1', 'G1 – 40 testers, 35 % replay', ['6']],
  ])
  expect(items[0]!.spec).toBe('One short solo show with six to eight AI characters, three rounds and a finale, on iOS, Android and the web.')
  expect(items[0]!.scope).toEqual(['US01', 'US02', 'US03', 'F01', 'AC01', 'AC02'])
  expect(roadmapSpecify(items[0]!)).toBe('One short solo show with six to eight AI characters, three rounds and a finale, on iOS, Android and the web. (Source: .specify/memory/prd.md §5; PRD ids US01, US02, US03, F01, AC01, AC02)')
  expect(parsePrdReview(REVIEW)).toEqual({ recommendation: 'build', blocking: ['D03 AI provider: recommend a provider with EU hosting', 'D05 Tester login: recommend invite codes'] })
  // §5 with its subsection, not §6; numbered as the PRD numbers them.
  const five = prdSections(PRD_MD, ['5'])
  expect(five).toContain('P0 is one short show.')
  expect(five).toContain('### 5 1 Ablauf')
  expect(five).not.toContain('The stage.')
  expect(prdSections(PRD_MD, ['5.1'])).toBe('### 5 1 Ablauf\nThree rounds and a finale.')
  const spec = parseSpec('# Feature Specification: Solo core\n\n**Input**: User description: "x"\n\n### User Story 1 - Start (PRD US01) (Priority: P1)\n\n## Requirements\n\n- **FR-001**: Users MUST confirm they are adults (PRD F01).\n')
  expect(prdCoverage(['US01', 'US02', 'F01', 'F010'], spec)).toEqual({ covered: ['US01', 'F01'], missing: ['US02', 'F010'] })
  expect(roadmapItemOf({ featureDir: 'specs/002-solo-beta', features: ['specs/001-solo-core', 'specs/002-solo-beta'], roadmap: items })?.title).toBe('Solo beta')
})

test('a folder with a PRD: imported, reviewed, the roadmap approved by the person, then Shape from it and the first feature specified from the roadmap', async ($, on) => {
  const seen = project(on, withPrd(), { answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  // The mod imports the PRD itself; the first step is its review, not Validate.
  expect(seen.files['.specify/memory/prd.md']).toBe(PRD_MD)
  const first = autopilotPrompts(seen)[0]!
  expect(first).toContain('prd: The PRD is imported: review it and cut it into features before the spec.')
  expect(first).toContain('speckit-xref:prd skill')
  expect(first).not.toContain('validate')
  seen.write('.specify/memory/prd-review.md', REVIEW)
  seen.write('.specify/memory/roadmap.md', ROADMAP)
  await runTurn($, 'The review and the roadmap are written.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Read the PRD review and the roadmap, then press Approve roadmap')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('Roadmap from the PRD: 2 features')
  expect(drawn).toContain('2. Solo beta (P1) · after G1 – 40 testers, 35 % replay')
  expect(drawn).toContain('Open: D03 AI provider')
  // Only the person's press approves it.
  expect(seen.files['.specify/xref/local/project.json']).toBeUndefined()
  await pane.press({ key: 'prd-approve' })
  expect(JSON.parse(seen.files['.specify/xref/local/project.json']!).prd.fingerprint).toBe(prdFingerprint(REVIEW, ROADMAP))
  await seen.clock.advance(0)
  const shape = autopilotPrompts(seen).at(-1)!
  expect(shape).toContain('shape:')
  expect(shape).toContain('Shape the first version from the PRD')
  seen.write('.specify/memory/product-brief.md', '# Product Brief\n')
  await runTurn($, 'Shaped.')
  await seen.clock.advance(0)
  const constitution = autopilotPrompts(seen).at(-1)!
  expect(constitution).toContain('constitution:')
  expect(constitution).toContain('Carry its ids: every requirement ends with the PRD id it comes from')
  seen.write('.specify/memory/constitution.md', '## Core Principles\n\n### I. Fun first\n\nEvery show MUST be playable in ten minutes.\n')
  await runTurn($, 'Constitution written.')
  await seen.clock.advance(0)
  const specify = autopilotPrompts(seen).at(-1)!
  expect(specify).toContain('specify: No feature yet; the roadmap names the first one: Solo core.')
  expect(specify).toContain('Run /speckit-specify One short solo show with six to eight AI characters')
  expect(specify).toContain('(Source: .specify/memory/prd.md §5; PRD ids US01, US02, US03, F01, AC01, AC02)')
})

test('/xref prd reads Markdown only', async ($, on) => {
  const seen = project(on, { ...withPrd(), 'docs/requirements.md': PRD_MD })
  await startSession($)
  expect((await xref($, 'prd docs/PRD.docx')).text).toBe('A PRD is read as Markdown: docs/PRD.docx is no .md file.')
  expect((await xref($, 'prd docs/requirements.md')).text).toContain('Imported docs/requirements.md to .specify/memory/prd.md.')
  expect(seen.files['.specify/memory/prd.md']).toBe(PRD_MD)
})

test('a done feature with a roadmap names the next one and its gate; Next from roadmap specifies it in the PRD\'s words', async ($, on) => {
  const done = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
  const seen = project(on, {
    ...DEMO,
    [`${FEATURE}/tasks.md`]: done,
    '.specify/memory/prd.md': PRD_MD,
    '.specify/memory/prd-review.md': REVIEW,
    '.specify/memory/roadmap.md': ROADMAP,
    '.specify/xref/local/project.json': JSON.stringify({ prd: { fingerprint: prdFingerprint(REVIEW, ROADMAP), at: '' } }),
  }, { tests: { exits: [0] }, answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Next in the roadmap: "Solo beta", after the gate G1 – 40 testers, 35 % replay (your part); press Next from roadmap')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('[Next from roadmap] [New feature] [Change] [Bug]')
  await pane.press({ key: 'next-roadmap' })
  await seen.clock.advance(0)
  const next = autopilotPrompts(seen).at(-1)!
  expect(next).toContain('Run /speckit-specify Thirty characters and voluntary coaching. (Source: .specify/memory/prd.md §6; PRD ids US07, F08) now')
  expect(next).toContain('Carry its ids')
})

test('verify sorts what it finds: only HIGH and MEDIUM become tasks; after two rounds closing the feature is the person\'s call', async ($, on) => {
  const tasks = parseTasks(DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]'))
  const snap = {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills', rules: rulesFrom(null), realTests: [],
    planFingerprint: 'p', testCommand: null, branch: null, phase: null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'),
  } as unknown as Snapshot
  const ledger = { ...emptyLedger(), approvals: { spec: 'x' }, checkpoints: { converge: tasksFingerprint(tasks) } }
  const verify = nextStep(snap, ledger, null, { review: 'none' })
  expect(verify.prompt).toContain(VERIFY_RULE)
  expect(VERIFY_RULE).toContain("Only HIGH and MEDIUM findings become tasks; name the LOW ones in your answer under 'Low, no task'.")
  expect(nextStep(snap, ledger, null, { review: 'none', verifies: 1 }).phase).toBe('verify')
  const limit = nextStep(snap, ledger, null, { review: 'none', verifies: MAX_VERIFIES })
  expect([limit.phase, limit.approve?.key, limit.approve?.value]).toEqual(['review', 'done', verify.approve!.value])
  expect(limit.needsUser).toContain('press Call it done in the pane')
  // The extension's check gets the same rule.
  expect(nextStep({ ...snap, extensions: ['xref'] } as Snapshot, ledger, null, { review: 'none' }).prompt).toContain('Run /speckit-xref-check now through the Skill tool and carry it through. Rate each finding')
})

test('Call it done closes the feature for this tree: the next start asks what comes next', async ($, on) => {
  const done = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: done }, { tests: { exits: [0] }, answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  // Two verify rounds that each changed something: the tasks change, so the done gate does not end the run.
  const add = (id: string) => seen.write(`${FEATURE}/tasks.md`, seen.files[`${FEATURE}/tasks.md`]! + `\n- [x] ${id} Found by verify in \`src/auth/token.ts\`\n`)
  add('T100')
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  add('T101')
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Look at what the last verifications added: press Call it done')
  expect(toText(await (await $.ui.mount({ ...PANE, surface: 'terminal' })).drawn())).toContain('[Call it done]')
  expect((await xref($, 'approve')).text).toBe(`Closed ${FEATURE} as done.`)
  expect(ledgerOf(seen.files).checkpoints.verify).toHaveLength(64)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('The feature is done. Say what comes next')
})

test('the intent check reads the PRD sections the feature implements', () => {
  const snap = { featureDir: FEATURE, spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks: [], prdExcerpt: prdSections(PRD_MD, ['5']) } as unknown as Snapshot
  const prompt = forkPrompt(snap, emptyLedger(), null, [], '')
  expect(prompt).toContain("The person's PRD, the sections this feature implements")
  expect(prompt).toContain('P0 is one short show.')
})

test('a -p run in a new project: the first prompt is the first step, with the PRD imported and its review handed over', { options: { autopilot: 'on' } }, async ($, on) => {
  const seen = project(on, withPrd(), { surfaces: [] })
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  await type($, 'Go on with the next step.')
  expect(seen.files['.specify/memory/prd.md']).toBe(PRD_MD)
  const context = seen.submitted.at(-1).context.join('\n')
  expect(context).toContain('[speckit-xref autopilot · step 1/25] prd: The PRD is imported: review it and cut it into features before the spec.')
  expect(context).toContain('speckit-xref:prd skill')
})

test('the PRD ids a feature implements and its spec lacks reach the plan step', () => {
  const items = parseRoadmap(ROADMAP)
  const spec = parseSpec('# Feature Specification: Solo core\n\n**Input**: User description: "x"\n\n## Requirements\n\n- **FR-001**: Users MUST confirm they are adults (PRD F01, US01).\n')
  const snap = {
    initialized: true, featureDir: 'specs/001-solo-core', features: ['specs/001-solo-core'], hasPlan: false, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true }, folder: 'existing', spec, tasks: [], constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills',
    rules: rulesFrom(null), realTests: [], planFingerprint: null, testCommand: null, branch: null, phase: null, tasksFingerprint: '', commands: ['plan'], checklists: [],
    persistence: 'flow-back', prd: true, roadmap: items, prdApproved: true,
  } as unknown as Snapshot
  const plan = nextStep(snap, { ...emptyLedger(), approvals: { spec: 'x' } }, null, { review: 'none' })
  expect(plan.phase).toBe('plan')
  expect(plan.notes).toContain('PRD ids of this feature the spec does not carry yet: US02, US03, AC01, AC02 (.specify/memory/prd.md). Cover each, or say why it belongs to a later feature.')
})

test('a roadmap changed after the approval asks again before the next feature comes from it', async ($, on) => {
  const done = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
  const seen = project(on, {
    ...DEMO,
    [`${FEATURE}/tasks.md`]: done,
    '.specify/memory/prd.md': PRD_MD,
    '.specify/memory/prd-review.md': REVIEW,
    '.specify/memory/roadmap.md': ROADMAP.replace('Thirty characters', 'Forty characters'),
    '.specify/xref/local/project.json': JSON.stringify({ prd: { fingerprint: prdFingerprint(REVIEW, ROADMAP), at: '' } }),
  }, { tests: { exits: [0] }, answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Read the roadmap again (.specify/memory/roadmap.md), then press Approve roadmap')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('The roadmap changed since you approved it: read it, then approve it again.')
  expect((await xref($, 'approve')).text).toContain('Approved the roadmap')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Next in the roadmap: "Solo beta"')
})
