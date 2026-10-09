import { describe, expect, test } from 'claude-code/testing'

import { extractPaths, parseConstitution, parseFeatureJson, parseSpec, parseTasks } from '../hooks/speckit'
import {
  appendRemediation,
  applySemantic,
  classify,
  composeSection,
  emptyLedger,
  evaluate,
  link,
  logIntent,
  parseSemantic,
  pathMatches,
  recordTouch,
  turnContext,
} from '../hooks/xref'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'

const FEATURE = 'specs/001-magic-link-login'
const snap = (): Snapshot => ({
  featureDir: FEATURE,
  spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!),
  tasks: parseTasks(DEMO[`${FEATURE}/tasks.md`]!),
  constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!),
  commandStyle: 'skills',
})

describe('Spec Kit readers', () => {
  test('reads the spec: title, the user\'s words, stories, requirements, scope', () => {
    const spec = parseSpec(DEMO[`${FEATURE}/spec.md`]!)
    expect(spec.title).toBe('Magic Link Login')
    expect(spec.input).toBe('Users sign in with a one-time link sent by email. No passwords.')
    expect(spec.stories.map(s => `${s.id} ${s.priority}`)).toEqual(['US1 P1', 'US2 P1', 'US3 P2'])
    expect(spec.reqs.map(r => r.id)).toEqual(['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'SC-001'])
    expect(spec.reqs.find(r => r.id === 'FR-005')?.needsClarification).toBe(true)
    expect(spec.outOfScope).toEqual(['Password-based login', 'Social login (Google, GitHub)'])
    expect(spec.assumptions).toEqual(['An SMTP provider is available.'])
  })

  test('reads tasks with their story, paths, requirement refs and phase', () => {
    const tasks = parseTasks(DEMO[`${FEATURE}/tasks.md`]!)
    expect(tasks.map(t => t.id)).toEqual(['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008'])
    expect(tasks.filter(t => t.done).map(t => t.id)).toEqual(['T001', 'T002', 'T003'])
    const t004 = tasks.find(t => t.id === 'T004')!
    expect(t004.story).toBe('US1')
    expect(t004.paths).toEqual(['src/auth/token.ts'])
    expect(t004.reqs).toEqual(['FR-002'])
    expect(t004.phase).toContain('User Story 1')
    expect(tasks.find(t => t.id === 'T001')!.paths).toEqual(['src/auth/', 'tests/auth/'])
    expect(tasks.find(t => t.id === 'T003')!.parallel).toBe(true)
    expect(tasks.find(t => t.id === 'T007')!.paths).toEqual(['src/auth/token.ts'])
  })

  test('finds paths in free text without mistaking abbreviations or routes for files', () => {
    expect(extractPaths('Add handler (e.g. see docs) in `lib/a.dart`, then update README.md')).toEqual(['lib/a.dart', 'README.md'])
    expect(extractPaths('Implement POST /auth/link handler in src/auth/request-link.ts')).toEqual(['src/auth/request-link.ts'])
    expect(extractPaths('Update README.md, then CHANGELOG.md.')).toEqual(['README.md', 'CHANGELOG.md'])
    expect(extractPaths('Something in "quoted/path.txt" and (src/x.py)')).toEqual(['quoted/path.txt', 'src/x.py'])
  })

  test('reads MUST rules and principles, and skips an unfilled template', () => {
    const c = parseConstitution(DEMO['.specify/memory/constitution.md']!)
    expect(c.principles).toEqual(['I. Test-First', 'II. Simplicity', 'III. Privacy'])
    expect(c.musts).toContain('Email addresses MUST NOT be written to logs.')
    expect(parseConstitution('### [PRINCIPLE_1_NAME]\n[PRINCIPLE_1_DESCRIPTION] MUST\n')).toEqual({ principles: [], musts: [] })
  })

  test('reads feature.json', () => {
    expect(parseFeatureJson('{"feature_directory":"specs/002-x"}')).toBe('specs/002-x')
    expect(parseFeatureJson('nope')).toBe(null)
  })
})

describe('X-Ref', () => {
  test('a path matches exactly, by folder, or by suffix', () => {
    expect(pathMatches('src/auth/token.ts', 'src/auth/token.ts')).toBe(true)
    expect(pathMatches('src/auth/new.ts', 'src/auth/')).toBe(true)
    expect(pathMatches('app/src/auth/token.ts', 'src/auth/token.ts')).toBe(true)
    expect(pathMatches('src/ui/theme.ts', 'src/auth/')).toBe(false)
  })

  test('classifies an edit as the current task, another task, the spec, or unplanned', () => {
    const s = snap()
    const ledger = emptyLedger()
    expect(classify('src/auth/token.ts', s, ledger, 'T004')).toEqual({ verdict: 'in-scope', task: 'T004' })
    expect(classify('src/auth/callback.ts', s, ledger, 'T004')).toEqual({ verdict: 'other-task', task: 'T006' })
    expect(classify('specs/001-magic-link-login/tasks.md', s, ledger, 'T004').verdict).toBe('spec')
    expect(classify('src/ui/theme.ts', s, ledger, 'T004')).toEqual({ verdict: 'unplanned', task: 'T004' })
    expect(classify('src/ui/theme.ts', s, ledger, 'T004', '// @spec FR-003\n').verdict).toBe('linked')
    // T001 (done) names the folder src/auth/: a new file there is no longer planned by it.
    expect(classify('src/auth/password-fallback.ts', s, ledger, 'T004').verdict).toBe('unplanned')
    const reopened = { ...s, tasks: s.tasks.map(t => (t.id === 'T001' ? { ...t, done: false } : t)) }
    expect(classify('src/auth/password-fallback.ts', reopened, ledger, 'T004')).toEqual({ verdict: 'other-task', task: 'T001' })
    // A file a done task names is rework on that task, not drift.
    expect(classify('src/config/mailer.ts', s, ledger, 'T004')).toEqual({ verdict: 'other-task', task: 'T002' })
  })

  test('an unplanned edit is drift until it is linked', () => {
    const s = snap()
    const touched = recordTouch(emptyLedger(), 'src/ui/theme.ts', { verdict: 'unplanned', task: 'T004' }, 'now')
    expect(evaluate(s, touched).level).toBe('yellow')
    const linked = link(touched, 'src/ui/theme.ts', '001-magic-link-login/FR-004', s)
    expect(linked.error).toBeUndefined()
    expect(evaluate(s, linked.ledger).level).toBe('green')
    expect(classify('src/ui/theme.ts', s, linked.ledger, 'T004').verdict).toBe('linked')
    expect(link(touched, 'src/ui/theme.ts', '002-other/FR-001', s).error).toContain('another feature')
    expect(link(touched, 'src/ui/theme.ts', 'FR-099', s).error).toContain('no requirement')
  })

  test('three unplanned edits turn the light red', () => {
    let ledger = emptyLedger()
    for (const f of ['a.ts', 'b.ts', 'c.ts']) ledger = recordTouch(ledger, f, { verdict: 'unplanned', task: null }, 'now')
    expect(evaluate(snap(), ledger).level).toBe('red')
  })

  test('counts FR coverage from task refs', () => {
    const report = evaluate(snap(), emptyLedger())
    expect(report.covered).toBe(4)
    expect(report.total).toBe(5)
    expect(report.uncovered).toEqual(['FR-005'])
    expect(`${report.done}/${report.tasks}`).toBe('3/8')
  })

  test('the system prompt section holds the spec but not the volatile task or drift', () => {
    const s = snap()
    const text = composeSection(s, 'advisory', 'speckit-xref')!
    expect(text).toContain('Active feature: specs/001-magic-link-login — Magic Link Login')
    expect(text).toContain('"Users sign in with a one-time link sent by email. No passwords."')
    expect(text).toContain('- Email addresses MUST NOT be written to logs.')
    expect(text).toContain('- Password-based login')
    expect(text).toContain('NEEDS CLARIFICATION: FR-005')
    expect(text).toContain('/speckit-clarify')
    expect(text).not.toContain('Current task')
    expect(text).not.toContain('Strict mode')
    expect(composeSection(s, 'strict', 'speckit-xref')).toContain('Strict mode')
    expect(composeSection({ ...s, commandStyle: 'commands' }, 'advisory', 'speckit-xref')).toContain('/speckit.clarify')
  })

  test('the per-prompt note carries the current task, its files and requirements', () => {
    const note = turnContext(snap(), emptyLedger(), null)!
    expect(note).toContain('tasks 3/8 · FR covered 4/5 · drift green')
    expect(note).toContain('Current task: T004 [US1] Implement token service in src/auth/token.ts (FR-002)')
    expect(note).toContain('Planned files: src/auth/token.ts')
    expect(note).toContain('- FR-002: System MUST send a single-use link that expires after 15 minutes.')
  })
})

describe('drift check', () => {
  test('reads the verdict out of a chatty reply and clamps the score', () => {
    const s = parseSemantic('Sure!\n{"score": 140, "verdict": "aligned", "reasons": ["ok"], "intent_changes": []}', 'now')!
    expect(s.score).toBe(100)
    expect(parseSemantic('no json here', 'now')).toBe(null)
    const derived = parseSemantic('{"score": 42}', 'now')!
    expect(derived.verdict).toBe('drift')
  })

  test('an intent change marks the logged prompt and makes the light red when it contradicts', () => {
    const s = snap()
    const ledger = logIntent(emptyLedger(), 'Please also allow passwords as a fallback', 'T004', 'now')
    const semantic = parseSemantic('{"score": 60, "verdict": "minor", "reasons": ["password fallback"], "intent_changes": [{"text": "allow passwords as a fallback", "kind": "contradicts"}]}', 'now')!
    const next = applySemantic(ledger, semantic)
    expect(next.intents[0]!.status).toBe('contradicts')
    const report = evaluate(s, next)
    expect(report.level).toBe('red')
    expect(report.findings.find(f => f.kind === 'intent')?.intent).toBe('allow passwords as a fallback')
  })

  test('a remediation task is numbered after the highest and lands under its own heading', () => {
    const s = snap()
    const first = appendRemediation(DEMO[`${FEATURE}/tasks.md`]!, s.tasks, 'Fold SMS login into the spec')
    expect(first.id).toBe('T009')
    expect(first.markdown).toContain('## Drift Remediation (speckit-xref)\n\n- [ ] T009 [Drift] Fold SMS login into the spec\n')
    const second = appendRemediation(first.markdown, parseTasks(first.markdown), 'Another')
    expect(second.id).toBe('T010')
    expect(second.markdown.match(/## Drift Remediation/g)?.length).toBe(1)
  })
})
