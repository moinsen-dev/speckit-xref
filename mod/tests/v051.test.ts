import { expect, test } from 'claude-code/testing'

import { renderDashboard } from '../hooks/dashboard'
import { designChangeFromGit, designChangeLine, designState, designToReview, designTokens, parseScreens, uiFromPlan } from '../hooks/design'
import { emptyLedger, evaluate, isSpecArtifact } from '../hooks/xref'
import { idleAutopilot, nextStep, phaseStrip, progressKey } from '../hooks/workflow'
import { parseConstitution, parseSpec } from '../hooks/speckit'
import { rulesFrom } from '../hooks/rules'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { BAND, FEATURE, PANE, ledgerOf, project, runTurn, startSession, toText, xref } from './harness'

// 0.5.1: a feature people look at gets its look after the plan and before the tasks: DESIGN.md, a mock per screen,
// and the person's eye on both.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const DESIGN = `---
name: Magic Link
description: calm and plain
colors:
  primary: "#1D1D1F"
  tertiary: "#2F5BD3"
  bad: "rgb(1,2,3);background:url(x)"
typography:
  body-md: { fontFamily: Inter, fontSize: 1rem }
  h1: { fontFamily: "Fraunces", fontSize: 2rem }
---

## Visual Theme & Atmosphere
Calm, one accent.
`

const SCREENS = `# Screens: Magic Link Login

**Design system**: created

| Screen | Serves | Mock | Notes |
|---|---|---|---|
| Request a link | US1, FR-001 | [request.html](request.html) | the start |
| **Signed in** | US2 FR-003 | \`signed-in.html\` | |
| Expired | US3-AS1, FR-004 | ../../../etc/passwd.html | a way up is no mock |
`

/** The demo feature planned as a web app, its tasks not written yet. */
function planned(): Record<string, string> {
  const files: Record<string, string> = { ...DEMO }
  delete files[`${FEATURE}/tasks.md`]
  files[`${FEATURE}/plan.md`] = files[`${FEATURE}/plan.md`]!.replace('**Testing**: vitest', '**Testing**: vitest\n**Project Type**: web-app (one page)')
  return files
}

test('a feature has a user interface when its plan says so; the template\'s placeholder says nothing', () => {
  expect(uiFromPlan('**Project Type**: mobile-app (cross-platform, eine Codebasis, kein Backend)')).toBe(true)
  expect(uiFromPlan('**Project Type**: web')).toBe(true)
  expect(uiFromPlan('**Project Type**: web-service')).toBe(false)
  expect(uiFromPlan('**Project Type**: cli')).toBe(false)
  expect(uiFromPlan('**Project Type**: library')).toBe(false)
  expect(uiFromPlan('**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]')).toBe(false)
  expect(uiFromPlan('**Project Type**: single\n**Target Platform**: iOS 16+, Android 8+')).toBe(true)
  expect(uiFromPlan('**Target Platform**: Linux server')).toBe(false)
  expect(uiFromPlan(null)).toBe(false)
})

test('screens.md: each screen, what it serves, its mock beside it; no way out of the folder', () => {
  const { screens, change } = parseScreens(SCREENS)
  expect(change).toBe('created')
  expect(screens.map(s => [s.name, s.serves, s.mock])).toEqual([
    ['Request a link', ['US1', 'FR-001'], 'request.html'],
    ['Signed in', ['US2', 'FR-003'], 'signed-in.html'],
    ['Expired', ['US3-AS1', 'FR-004'], null],
  ])
  expect(parseScreens('# Screens\n\n**Design system**: unchanged\n\nNo screen changes.\n')).toEqual({ screens: [], change: 'unchanged' })
  // DESIGN.md's tokens: colours with their values, fonts; anything but a colour stays out of the page.
  const tokens = designTokens(DESIGN)
  expect(tokens).toEqual({ name: 'Magic Link', colors: [['primary', '#1D1D1F'], ['tertiary', '#2F5BD3']], fonts: ['Inter', 'Fraunces'] })
})

test('a feature people look at gets its look after the plan, then the person approves it before the tasks', async ($, on) => {
  const seen = project(on, planned(), { answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const first = autopilotPrompts(seen)[0]!
  expect(first).toContain(`design: ${FEATURE} has a user interface`)
  expect(first).toContain('speckit-xref:design skill')
  expect(first).toContain(`${FEATURE}/design/screens.md`)
  expect(first).toContain('There is no DESIGN.md yet')
  expect(first).toContain('Do not ask the person here')
  // Claude draws it; the run stops for the person's eye, and the terminal points to where the mocks can be seen.
  seen.write('DESIGN.md', DESIGN)
  seen.write(`${FEATURE}/design/screens.md`, SCREENS)
  seen.write(`${FEATURE}/design/request.html`, '<!doctype html><title>Request</title>')
  await runTurn($, 'The look is drawn.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Look at DESIGN.md and the mocks (/xref web or Mocks in the pane')
  expect(autopilotPrompts(seen)).toHaveLength(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('▶design')
  expect(drawn).toContain('[Approve design] [Open the mocks]')
  expect(drawn).toContain('Request a link · US1 FR-001')
  expect(drawn).toContain('Expired · US3-AS1 FR-004 · no mock')
  expect(toText(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).drawn())).toContain('[Approve design]')
  // The model cannot pass the gate: only the person's press approves this design.
  expect(ledgerOf(seen.files)?.approvals?.design).toBeUndefined()
  await pane.press({ key: 'approve' })
  expect(ledgerOf(seen.files).approvals.design).toHaveLength(64)
  await seen.clock.advance(0)
  const tasks = autopilotPrompts(seen).at(-1)!
  expect(tasks).toContain('Run /speckit-tasks now')
  expect(tasks).toContain(`Build to DESIGN.md and ${FEATURE}/design/screens.md`)
})

test('a design changed after the approval is shown again; a feature without screens or with design: off has no gate', () => {
  const snapOf = (designMd: string | null, screensMd: string | null, planLine = '**Project Type**: web-app'): Snapshot =>
    ({
      initialized: true,
      featureDir: FEATURE,
      features: [FEATURE],
      hasPlan: true,
      extensions: [],
      claudeIntegration: true,
      speckitVersion: '1.1.2',
      tools: { specify: true, uvx: true },
      folder: 'existing',
      spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!),
      tasks: [],
      constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
      commandStyle: 'skills',
      rules: rulesFrom(null),
      realTests: [],
      planFingerprint: 'p',
      testCommand: null,
      branch: null,
      phase: null,
      tasksFingerprint: '',
      commands: ['tasks', 'implement'],
      checklists: [],
      persistence: 'flow-back',
      ui: uiFromPlan(planLine),
      design: designState(designMd, screensMd),
    }) as Snapshot
  const flow = { review: 'spec+design' as const }
  const drawn = snapOf(DESIGN, SCREENS)
  const gate = nextStep(drawn, emptyLedger(), null, flow)
  expect(gate.approve?.key).toBe('design')
  expect(gate.phase).toBe('review')
  const approved = { ...emptyLedger(), approvals: { design: gate.approve!.value } }
  expect(nextStep(drawn, approved, null, flow).phase).toBe('tasks')
  // Mutation: the approval holds for this text only.
  expect(nextStep(snapOf(DESIGN.replace('#2F5BD3', '#FF6B3D'), SCREENS), approved, null, flow).approve?.key).toBe('design')
  expect(nextStep(snapOf(DESIGN, SCREENS.replace('the start', 'the first screen')), approved, null, flow).approve?.key).toBe('design')
  // Not drawn yet: the design step; screens without a design system to draw on: the step again.
  expect(nextStep(snapOf(null, null), emptyLedger(), null, flow).phase).toBe('design')
  expect(nextStep(snapOf(null, SCREENS), emptyLedger(), null, flow).phase).toBe('design')
  // A feature that changes no screen and leaves DESIGN.md as it is goes straight to its tasks.
  expect(nextStep(snapOf(DESIGN, '**Design system**: unchanged\n\nNo screen changes.\n'), emptyLedger(), null, flow).phase).toBe('tasks')
  // review: spec draws but does not stop; design: off does not draw; a CLI has no look.
  expect(nextStep(drawn, emptyLedger(), null, { review: 'spec' }).phase).toBe('tasks')
  expect(nextStep(snapOf(null, null), emptyLedger(), null, { ...flow, design: false }).phase).toBe('tasks')
  expect(nextStep(snapOf(null, null, '**Project Type**: cli'), emptyLedger(), null, flow).phase).toBe('tasks')
  // The strip shows the design column and the review in it; a drawn design is progress for the stall check.
  expect(phaseStrip(drawn, gate)).toContain('✓plan ▶design ·tasks')
  expect(progressKey(snapOf(null, null), emptyLedger())).not.toBe(progressKey(drawn, emptyLedger()))
})

test('screens.md\'s word on DESIGN.md is checked against git: a claim git does not back is named at the review', () => {
  expect(designChangeFromGit('')).toBe('unchanged')
  expect(designChangeFromGit(' M DESIGN.md\n')).toBe('extended')
  expect(designChangeFromGit('?? DESIGN.md\n')).toBe('created')
  expect(designChangeFromGit('A  DESIGN.md\n')).toBe('created')
  const design = { ...designState(DESIGN, SCREENS.replace('created', 'extended (token onAccent added)')), verified: 'unchanged' as const }
  expect(designChangeLine(design)).toBe(' (screens.md says "extended", but git shows DESIGN.md unchanged)')
  expect(designChangeLine({ ...design, verified: 'extended' })).toBe(', DESIGN.md extended')
  expect(designChangeLine({ ...design, verified: null })).toBe(', DESIGN.md extended')
  // Without screens, only a change git shows makes a review.
  expect(designToReview({ ...design, screens: [] })).toBe(false)
  expect(designToReview({ ...design, screens: [], verified: 'created' })).toBe(true)
})

test('the design is never drift: DESIGN.md and the feature\'s design folder are spec artifacts', () => {
  expect(isSpecArtifact('DESIGN.md')).toBe(true)
  expect(isSpecArtifact(`${FEATURE}/design/request.html`)).toBe(true)
  expect(isSpecArtifact('docs/DESIGN.md')).toBe(false)
})

test('the dashboard shows the colours, the fonts and each screen with its mock in a sandboxed frame', () => {
  const snap = { featureDir: FEATURE, spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks: [], constitution: null, rules: rulesFrom(null), realTests: [], branch: null, phase: null } as unknown as Snapshot
  const ledger = emptyLedger()
  const input = {
    generatedAt: '2026-10-10T12:00:00.000Z',
    root: '/work',
    snap,
    ledger,
    report: evaluate(snap, ledger),
    levels: {},
    step: { phase: 'review', line: 'The design is drafted.', needsUser: 'Look at DESIGN.md and the mocks' },
    strip: '✓setup ✓const ✓spec ✓plan ▶design ·tasks ·impl ·verify',
    autopilot: idleAutopilot(),
    runLog: [],
    docs: [],
    design: { dir: `${FEATURE}/design`, screens: parseScreens(SCREENS).screens, tokens: designTokens(DESIGN), approved: false },
    refreshSeconds: 0,
  }
  const html = renderDashboard(input)
  expect(html).toContain('<a href="#design">Design</a>')
  expect(html).toContain('style="background:#2F5BD3"')
  expect(html).not.toContain('url(x)')
  expect(html).toContain('Inter · Fraunces')
  expect(html).toContain(`<iframe src="file:///work/${FEATURE}/design/request.html" title="Request a link" loading="lazy" sandbox></iframe>`)
  expect(html).toContain('Open the mock')
  expect(html).toContain('⏸ not approved yet')
  // No design, no section.
  expect(renderDashboard({ ...input, design: null })).not.toContain('#design')
})

test('/speckit-tasks typed by the person approves the design that stands before it; /speckit-plan does not', async ($, on) => {
  const files = planned()
  files['DESIGN.md'] = DESIGN
  files[`${FEATURE}/design/screens.md`] = SCREENS
  const seen = project(on, files)
  await startSession($)
  await $.prompt.submit({ text: 'noch mal /speckit-plan', wait: false, origin: { kind: 'composer' } })
  expect(ledgerOf(seen.files)?.approvals?.design).toBeUndefined()
  await $.prompt.submit({ text: 'sieht gut aus, /speckit-tasks', wait: false, origin: { kind: 'composer' } })
  expect(ledgerOf(seen.files).approvals.design).toHaveLength(64)
  expect(seen.toasts.at(-1)).toBe('Approved the design: you ran /speckit-tasks.')
})
