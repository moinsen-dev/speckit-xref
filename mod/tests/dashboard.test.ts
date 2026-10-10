import { expect, test } from 'claude-code/testing'

import { linkIds, markdownToHtml, renderDashboard } from '../hooks/dashboard'
import type { DashboardInput } from '../hooks/dashboard'
import { levelOf } from '../hooks/proof'
import { rulesFrom } from '../hooks/rules'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { idleAutopilot, openPhase, tasksFingerprint } from '../hooks/workflow'
import { emptyLedger, evaluate } from '../hooks/xref'
import type { Ledger, Snapshot } from '../types'
import { DEMO } from './fixtures/demo'

// 0.5.0: the local HTML dashboard, written after every autopilot step.

const FEATURE = 'specs/001-magic-link-login'
const SPEC = DEMO[`${FEATURE}/spec.md`]!
const TASKS = `${DEMO[`${FEATURE}/tasks.md`]!}- [ ] T009 Escape <script>alert(1)</script> in src/ui/banner.ts\n`

function snapOf(specMd = SPEC, tasksMd = TASKS): Snapshot {
  const tasks = parseTasks(tasksMd)
  return {
    initialized: true,
    featureDir: FEATURE,
    features: [FEATURE],
    hasPlan: true,
    extensions: [],
    claudeIntegration: true,
    speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true },
    folder: 'existing',
    spec: parseSpec(specMd),
    tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
    commandStyle: 'skills',
    rules: rulesFrom(null),
    realTests: [],
    planFingerprint: null,
    testCommand: 'npx vitest run',
    branch: '001-magic-link-login',
    phase: openPhase(tasks),
    tasksFingerprint: tasksFingerprint(tasks),
    commands: ['analyze', 'implement'],
    checklists: [],
    persistence: 'flow-back',
  }
}

function inputOf(opts: { snap?: Snapshot; ledger?: Ledger; refreshSeconds?: number; root?: string } = {}): DashboardInput {
  const snap = opts.snap ?? snapOf()
  const ledger = opts.ledger ?? emptyLedger()
  const proof = { featureDir: snap.featureDir, tasks: snap.tasks, reqs: snap.spec?.reqs ?? [], realTests: snap.realTests }
  const levels = Object.fromEntries((snap.spec?.reqs ?? []).filter(r => r.kind === 'FR' && r.status === 'active').map(r => [r.id, levelOf(r.id, proof, ledger)]))
  return {
    generatedAt: '2026-10-10T12:00:00.000Z',
    root: opts.root ?? '/work',
    snap,
    ledger,
    report: evaluate(snap, ledger),
    levels,
    step: { phase: 'implement', line: '/speckit-implement · 6 of 9 tasks open; next T004.', needsUser: null },
    strip: '✓setup ✓const ◌spec ✓plan ✓tasks ▶impl 3/9 ·verify',
    autopilot: { ...idleAutopilot(), on: true, steps: 3, max: 25 },
    runLog: [
      { at: '2026-10-10T11:50:00.000Z', step: 2, phase: 'analyze', task: null, files: [], durationMs: 42000, tokens: 9000, outcome: 'analysis clean' },
      { at: '2026-10-10T11:58:00.000Z', step: 3, phase: 'implement', task: 'T004', files: ['src/auth/token.ts', 'tests/auth/token.test.ts'], durationMs: 75000, tokens: 12345, outcome: 'T004 checked' },
    ],
    docs: [
      { path: `${FEATURE}/spec.md`, title: 'Spec', markdown: SPEC },
      { path: `${FEATURE}/tasks.md`, title: 'Tasks', markdown: TASKS },
    ],
    refreshSeconds: opts.refreshSeconds ?? 0,
  }
}

/** The matrix row of a requirement, from its anchor to the end of the row. */
const rowOf = (html: string, id: string) => {
  const at = html.indexOf(`<tr id="req-${id}"`)
  expect(at).toBeGreaterThan(-1)
  return html.slice(at, html.indexOf('</tr>', at))
}

test('dashboard: the person\'s words, the matrix with rungs and task links, the footer, no script without refresh', () => {
  const html = renderDashboard(inputOf())
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('<meta name="viewport"')
  expect(html).toContain('Users sign in with a one-time link sent by email. No passwords.')
  expect(html).toContain('drift ● ok')
  expect(html).toContain('autopilot ▶ on · step 3/25')
  // FR-002 is named by the open T004: planned, linked to its task.
  const fr2 = rowOf(html, 'FR-002')
  expect(fr2).toContain('href="#task-T004"')
  expect(fr2).toContain('◔ planned')
  expect(rowOf(html, 'FR-005')).toContain('○ specified')
  expect(rowOf(html, 'FR-005')).toContain('needs clarification')
  expect(rowOf(html, 'SC-001')).not.toContain('class="rung r-')
  // Scenarios get rows too, so USn-ASm links land somewhere.
  expect(html).toContain('id="req-US1-AS1"')
  expect(html).toContain('id="task-T004"')
  expect(html).toContain('This page is local and is regenerated after every step. It holds your own words: keep it out of commits and do not share it.')
  expect(html).not.toContain('location.reload')
  expect(html).not.toContain('<script')
})

test('dashboard: a task text with markup stays text, everywhere', () => {
  const html = renderDashboard(inputOf())
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('dashboard: phases with progress and the running one, the run log newest first, the documents', () => {
  const html = renderDashboard(inputOf())
  expect(html).toContain('▶ running')
  expect(html).toContain('✓ done')
  expect(html).toContain('US1 Request a login link (P1) MVP')
  expect(html).toContain('aria-valuenow="1"')
  const newer = html.indexOf('<td class="num">12,345</td>')
  const older = html.indexOf('<td class="num">9,000</td>')
  expect(newer).toBeGreaterThan(-1)
  expect(newer).toBeLessThan(older)
  expect(html).toContain('01:15')
  expect(html).toContain('<a href="#task-T004">T004</a> checked')
  expect(html).toContain(`<details class="doc" data-key="${FEATURE}/spec.md" open>`)
  expect(html).toContain(`<details class="doc" data-key="${FEATURE}/tasks.md">`)
  expect(html).toContain(`href="file:///work/${FEATURE}/spec.md"`)
  // tasks.md rendered: its task boxes, its ids linked to the tasks section.
  expect(html).toContain('<input type="checkbox" disabled checked> <a href="#task-T001">T001</a>')
})

test('dashboard: files, proof and verification of a requirement; superseded rows struck through; decisions and intents', () => {
  const spec = SPEC.replace('- **FR-005**:', '- **FR-006**: Old login form, SUPERSEDED by FR-001\n- **FR-005**:')
  const snap = snapOf(spec)
  const ledger: Ledger = {
    ...emptyLedger(),
    tasks: { T004: { touched: ['src/auth/token.ts'], linked: [] } },
    anchors: [{ id: '001-magic-link-login/FR-002', file: 'tests/auth/token.test.ts', line: 3 }],
    verification: { 'FR-002': { status: 'passing', tests: ['token expires', 'token single use'], at: '2026-10-10T11:59:00.000Z', commit: 'abc', fingerprint: '' } },
    decisions: [{ id: 'D1', question: 'Rate limit per hour?', options: ['5', '10'], blocks: ['US1'], at: '2026-10-10T10:00:00.000Z', answer: null }],
    intents: [{ at: '2026-10-10T11:00:00.000Z', text: 'add a dark mode', task: null, status: 'extends' }],
    unplanned: [{ file: 'src/extra.ts', at: '2026-10-10T11:30:00.000Z', task: 'T004', acknowledged: false }],
  }
  const html = renderDashboard(inputOf({ snap, ledger, root: '/Users/me/my app' }))
  const fr2 = rowOf(html, 'FR-002')
  expect(fr2).toContain('src/auth/token.ts')
  expect(fr2).toContain('tests/auth/token.test.ts</a> <span class="tag">test</span>')
  expect(fr2).toContain('✓ passing')
  expect(fr2).toContain('2 tests · 2026-10-10')
  expect(fr2).toContain('href="file:///Users/me/my%20app/src/auth/token.ts"')
  const fr6 = rowOf(html, 'FR-006')
  expect(fr6).toContain('<s>')
  expect(fr6).toContain('↷ superseded')
  expect(fr6).toContain('→ <a href="#req-FR-001">FR-001</a>')
  expect(html).toContain('Rate limit per hour? → <span class="warn">▲ open</span>')
  expect(html).toContain('▲ beyond the spec')
  expect(html).toContain('add a dark mode')
  expect(html).toContain('src/extra.ts is not planned for any task')
})

test('dashboard: the person\'s words keep their line breaks; the refresh script remembers scroll and open documents', () => {
  const spec = SPEC.replace('**Input**: User description: "Users sign in with a one-time link sent by email. No passwords."', '**Input**: User description: "Users sign in by link.\nNo <b>passwords</b>."')
  const html = renderDashboard(inputOf({ snap: snapOf(spec), refreshSeconds: 15 }))
  expect(html).toContain('<blockquote class="words">Users sign in by link.\nNo &lt;b&gt;passwords&lt;/b&gt;.</blockquote>')
  expect(html).toContain('location.reload()')
  expect(html).toContain('setTimeout(tick, 15000)')
  expect(html).toContain('sessionStorage')
  expect(html).toContain('document.hidden || selected')
  // Deterministic: the same input renders the same page.
  expect(renderDashboard(inputOf({ snap: snapOf(spec), refreshSeconds: 15 }))).toBe(html)
})

test('markdownToHtml: headings, emphasis, code, nested lists, task boxes, tables, quotes, rules', () => {
  const html = markdownToHtml(
    [
      '# Plan',
      '',
      'Some **bold**, *italic*, `a<b>` and feature_directory stays.',
      '',
      '- one',
      '  - nested',
      '- [x] done item',
      '- [ ] open item',
      '',
      '1. first',
      '2. second',
      '',
      '| Col | Other |',
      '|-----|:-----:|',
      '| a | b \\| c |',
      '',
      '```ts',
      'const x = "<y>"',
      '```',
      '',
      '> quoted **text**',
      '',
      '---',
    ].join('\n'),
  )
  expect(html).toContain('<h1>Plan</h1>')
  expect(html).toContain('<strong>bold</strong>')
  expect(html).toContain('<em>italic</em>')
  expect(html).toContain('<code>a&lt;b&gt;</code>')
  expect(html).toContain('feature_directory stays')
  expect(html).toContain('<ul><li>one<ul><li>nested</li></ul></li><li class="task"><input type="checkbox" disabled checked> done item</li>')
  expect(html).toContain('<input type="checkbox" disabled> open item')
  expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
  expect(html).toContain('<div class="scroll"><table><thead><tr><th>Col</th><th style="text-align:center">Other</th></tr></thead>')
  expect(html).toContain('<td style="text-align:center">b | c</td>')
  expect(html).toContain('<pre><code class="lang-ts">const x = &quot;&lt;y&gt;&quot;</code></pre>')
  expect(html).toContain('<blockquote><p>quoted <strong>text</strong></p></blockquote>')
  expect(html).toContain('<hr>')
})

test('markdownToHtml: raw HTML is text; only http, https, file and relative links become links', () => {
  const html = markdownToHtml('<img src=x onerror=alert(1)> [ok](https://example.com/a_b_c?x=1&y=2) [rel](./plan.md) [bad](javascript:alert(1)) [data](data:text/html,x)')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).toContain('<a href="https://example.com/a_b_c?x=1&amp;y=2">ok</a>')
  expect(html).toContain('<a href="./plan.md">rel</a>')
  expect(html).not.toContain('href="javascript:')
  expect(html).not.toContain('href="data:')
  expect(html).toContain('[bad](javascript:alert(1))')
})

test('linkIds: requirement, task and scenario ids become anchors; short ids and ids in links or code stay', () => {
  expect(linkIds('<p>FR-002 and T004, SC-001, US1-AS1</p>')).toBe(
    '<p><a href="#req-FR-002">FR-002</a> and <a href="#task-T004">T004</a>, <a href="#req-SC-001">SC-001</a>, <a href="#req-US1-AS1">US1-AS1</a></p>',
  )
  expect(linkIds('<p>FR-0 and T04 and XT004</p>')).toBe('<p>FR-0 and T04 and XT004</p>')
  expect(linkIds('<a href="#x">FR-002</a> <code>T004</code> <pre>FR-003</pre>')).toBe('<a href="#x">FR-002</a> <code>T004</code> <pre>FR-003</pre>')
  expect(linkIds('<td id="req-FR-001">x</td>')).toBe('<td id="req-FR-001">x</td>')
  // Linking twice changes nothing.
  const once = linkIds('<p>FR-002</p>')
  expect(linkIds(once)).toBe(once)
})

test('dashboard: a project without a feature still renders every section', () => {
  const snap: Snapshot = { ...snapOf(), featureDir: null, spec: null, tasks: [], constitution: null, phase: null }
  const input = { ...inputOf({ snap }), runLog: [], docs: [], autopilot: { ...idleAutopilot(), idea: 'A <b>todo</b> app' } }
  const html = renderDashboard(input)
  expect(html).toContain('drift · no feature')
  expect(html).toContain('autopilot ○ off')
  expect(html).toContain('A &lt;b&gt;todo&lt;/b&gt; app')
  expect(html).toContain('No tasks.md yet.')
  expect(html).toContain('No autopilot step yet.')
})
