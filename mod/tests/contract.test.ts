import { describe, expect, test } from 'claude-code/testing'

import { ledgerFromParts, ledgerToParts, migrateV1 } from '../hooks/ledger'
import { levelOf, parseJunit, verificationFrom } from '../hooks/proof'
import { featureFromBranch, fingerprint, globToRegExp, hasRealTests, isTestFile, normalizeText, parseIgnore, reqStatus, rulesFrom } from '../hooks/rules'
import { parseSpec } from '../hooks/speckit'
import { classifyCore, evaluate } from '../hooks/xref'
import type { Snapshot } from '../types'
import { CASES } from './fixtures/cases'

// docs/contract-0.4.md: the same cases run in `xref.py selftest`, so the mod and the extension cannot drift apart.

const COMMITTED = ['map', 'links', 'fingerprints', 'accepted']
/** A case's ledger, given as v2 parts, through the load function both sides share. */
function ledgerOf(parts: Record<string, unknown>) {
  const committed: Record<string, unknown> = { schema_version: 2 }
  const local: Record<string, unknown> = { schema_version: 2 }
  for (const [k, v] of Object.entries(parts)) (COMMITTED.includes(k) ? committed : local)[k] = v
  return ledgerFromParts(JSON.stringify(committed), JSON.stringify(local))
}

/** A case's snapshot: reqs without kind or status are FRs with the status their text gives. */
function snapOf(raw: any): Snapshot {
  const reqs = (raw.reqs ?? (raw.reqIds ?? []).map((id: string) => ({ id, text: id }))).map((r: any) => ({ kind: 'FR', needsClarification: false, ...reqStatus(r.text), ...r }))
  return {
    featureDir: raw.featureDir ?? 'specs/001-magic-link-login',
    tasks: raw.tasks.map((t: any) => ({ parallel: false, story: null, text: t.id, phase: '', ...t })),
    spec: { title: 'x', input: null, stories: (raw.stories ?? []).map((s: any) => ({ title: s.id, priority: null, ...s })), reqs, outOfScope: [], assumptions: [] },
    realTests: raw.realTests ?? [],
  } as unknown as Snapshot
}

describe('contract: fingerprints and paths', () => {
  test('normalizes and hashes text as the extension does', () => {
    for (const c of CASES.fingerprint) {
      expect(normalizeText(c.text)).toBe(c.normalized)
      expect(fingerprint(c.text)).toBe(c.sha256)
    }
  })

  test('matches globs, reads .xrefignore, tells test files and real tests apart', () => {
    for (const c of CASES.glob) expect(`${c.pattern} ~ ${c.path}: ${globToRegExp(c.pattern).test(c.path)}`).toBe(`${c.pattern} ~ ${c.path}: ${c.match}`)
    for (const c of CASES.ignoreFile) expect(parseIgnore(c.text)).toEqual(c.expected)
    for (const c of CASES.isTestFile) expect(`${c.path}: ${isTestFile(c.path)}`).toBe(`${c.path}: ${c.isTest}`)
    for (const c of CASES.hasRealTests) expect(`${JSON.stringify(c.text)}: ${hasRealTests(c.text)}`).toBe(`${JSON.stringify(c.text)}: ${c.real}`)
  })

  test('finds the feature a branch names, and a requirement\'s status', () => {
    for (const c of CASES.featureFromBranch) expect(featureFromBranch(c.branch, c.dirs)).toBe(c.expected)
    for (const c of CASES.reqStatus) expect(reqStatus(c.text)).toEqual({ status: c.status, supersededBy: c.supersededBy })
  })
})

describe('contract: classification, ladder, report', () => {
  test('classifies in the shared order', () => {
    for (const c of CASES.classifyCore) {
      const rules = rulesFrom(c.rules?.ignoreFile ?? null)
      const got = classifyCore(c.rel, snapOf(c.snap), ledgerOf({ links: c.ledger.links, anchors: c.ledger.anchors }), rules, c.newText)
      expect(`${c.name}: ${got.verdict} ${got.task}`).toBe(`${c.name}: ${c.expected.verdict} ${c.expected.task}`)
    }
  })

  test('puts each requirement on its rung', () => {
    const snap = snapOf(CASES.levelOf.snap)
    const proof = { featureDir: snap.featureDir, tasks: snap.tasks, reqs: snap.spec!.reqs, realTests: snap.realTests }
    for (const c of CASES.levelOf.cases) expect(`${c.name}: ${levelOf(c.id, proof, ledgerOf(c.ledger))}`).toBe(`${c.name}: ${c.expected}`)
  })

  test('reports drift from deterministic findings, and the intent check only when asked', () => {
    const snap = snapOf(CASES.evaluate.snap)
    for (const c of CASES.evaluate.cases) {
      const r = evaluate(snap, ledgerOf(c.ledger), { semantic: c.semantic })
      expect({ name: c.name, level: r.level, kinds: r.findings.map(f => f.kind), covered: r.covered, total: r.total, notes: r.notes }).toEqual({ name: c.name, ...c.expected })
    }
  })
})

describe('contract: scenarios, test results, ledger files', () => {
  test('numbers acceptance scenarios per story', () => {
    for (const c of CASES.scenarios) expect(parseSpec(c.markdown).stories.map(s => ({ id: s.id, scenarios: s.scenarios }))).toEqual(c.expected)
  })

  test('reads JUnit and turns it into verification per requirement', () => {
    for (const c of CASES.junit) {
      const cases = parseJunit(c.xml)
      expect(cases).toEqual(c.expectedCases)
      expect(verificationFrom(cases, c.anchors, c.fingerprints, c.featureDir, c.at, c.commit)).toEqual(c.expectedVerification)
    }
  })

  test('migrates a v1 ledger into the committed and the local half', () => {
    for (const c of CASES.migrateV1) {
      const parts = migrateV1(c.v1)
      expect(parts.committed).toEqual(c.committed)
      expect(parts.local).toEqual(c.local)
      // Loading the v1 file and writing it again gives the same halves.
      const written = ledgerToParts(ledgerFromParts(JSON.stringify(c.v1), null), c.v1.feature)
      expect(JSON.parse(written.committed)).toEqual(c.committed)
      const local = JSON.parse(written.local)
      expect({ touched: local.touched, unplanned: local.unplanned, intents: local.intents, anchors: local.anchors }).toEqual({ touched: c.local.touched, unplanned: c.local.unplanned, intents: c.local.intents, anchors: c.local.anchors })
    }
  })

  test('writes the committed half as the same bytes for the same state, and keeps keys it does not know', () => {
    const ledger = ledgerFromParts(JSON.stringify({ schema_version: 2, links: { 'b.ts': ['T002', 'FR-001'], 'a.ts': ['FR-001'] }, map: { 'FR-001': ['T002', 'T001'] }, review: { by: 'x' } }), JSON.stringify({ schema_version: 2, run: { n: 1 } }))
    const once = ledgerToParts(ledger, 'specs/001-x')
    const twice = ledgerToParts(ledgerFromParts(once.committed, once.local), 'specs/001-x')
    expect(twice.committed).toBe(once.committed)
    expect(once.committed.indexOf('"a.ts"')).toBeLessThan(once.committed.indexOf('"b.ts"'))
    expect(JSON.parse(once.committed).map['FR-001']).toEqual(['T001', 'T002'])
    expect(JSON.parse(once.committed).review).toEqual({ by: 'x' })
    expect(JSON.parse(once.local).run).toEqual({ n: 1 })
    expect(once.committed).not.toContain('updated_at')
  })
})
