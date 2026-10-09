// Proof instead of claims (docs/contract-0.4.md §4, §9): how far each requirement got, and what the tests said.

import type { Anchor, Ledger, Req, Task, Verification } from '../types'
import { fingerprint, isTestFile, localId, reqStatus } from './rules'

export const LADDER = ['specified', 'planned', 'implemented', 'tested', 'passing'] as const
export type Rung = (typeof LADDER)[number]

/** What the ladder reads off the snapshot; `realTests` are the test files with real tests in them. */
export type ProofSnap = { featureDir: string | null; tasks: Pick<Task, 'id' | 'done' | 'reqs'>[]; reqs: Pick<Req, 'id' | 'text'>[]; realTests: string[] }

export const isActive = (req: Pick<Req, 'text'> & { status?: Req['status'] }) => (req.status ?? reqStatus(req.text).status) === 'active'

/** The tasks that own a requirement: those naming it, and those mapped to it. */
export function owners(id: string, snap: ProofSnap, ledger: Ledger): Pick<Task, 'id' | 'done' | 'reqs'>[] {
  const mapped = new Set(ledger.requirements[id]?.tasks ?? [])
  return snap.tasks.filter(t => t.reqs.includes(id) || mapped.has(t.id))
}

/** Whether a stored fingerprint says the requirement's text changed since it was last proven. */
export function isStale(id: string, snap: ProofSnap, ledger: Ledger): boolean {
  const stored = ledger.fingerprints[id]
  const req = snap.reqs.find(r => r.id === id)
  return !!stored && !!req && stored !== fingerprint(req.text)
}

export function levelOf(id: string, snap: ProofSnap, ledger: Ledger): Rung {
  const level = rawLevel(id, snap, ledger)
  // A changed requirement needs new proof: whatever it had, it is planned at most.
  return isStale(id, snap, ledger) && LADDER.indexOf(level) > 1 ? 'planned' : level
}

function rawLevel(id: string, snap: ProofSnap, ledger: Ledger): Rung {
  const own = owners(id, snap, ledger)
  if (!own.length) return 'specified'
  const anchored = (a: Anchor) => localId(a.id, snap.featureDir) === id
  const linked = ledger.requirements[id]?.files ?? []
  const touched = own.flatMap(t => ledger.tasks[t.id]?.touched ?? [])
  const code = [...ledger.anchors.filter(anchored).map(a => a.file), ...linked, ...touched].some(f => !isTestFile(f))
  if (!own.some(t => t.done) || !code) return 'planned'
  const real = new Set(snap.realTests)
  const tested = [...ledger.anchors.filter(anchored).map(a => a.file), ...linked].some(f => isTestFile(f) && real.has(f))
  if (!tested) return 'implemented'
  const req = snap.reqs.find(r => r.id === id)
  const v = ledger.verification[id]
  return v?.status === 'passing' && req && v.fingerprint === fingerprint(req.text) ? 'passing' : 'tested'
}

/** How many active functional requirements stand on each rung. */
export function levels(snap: ProofSnap & { reqs: (Pick<Req, 'id' | 'text'> & { kind?: string; status?: Req['status'] })[] }, ledger: Ledger): Record<Rung, number> {
  const counts = Object.fromEntries(LADDER.map(r => [r, 0])) as Record<Rung, number>
  for (const req of snap.reqs) if ((req.kind ?? 'FR') === 'FR' && isActive(req)) counts[levelOf(req.id, snap, ledger)] += 1
  return counts
}

// ---- Test results (§9) ----

export type JunitCase = { name: string; classname: string; file: string; status: 'passed' | 'failed' | 'skipped' }

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  return m ? unescape(m[2] ?? m[3] ?? '') : ''
}

export function parseJunit(xml: string): JunitCase[] {
  const cases: JunitCase[] = []
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
  for (const m of xml.matchAll(re)) {
    const tag = m[1] ?? ''
    const body = m[3] ?? ''
    const status = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed'
    cases.push({ name: attr(tag, 'name'), classname: attr(tag, 'classname'), file: attr(tag, 'file'), status })
  }
  return cases
}

const IDS = /\b(?:(?:FR|SC)-\d{3,}|US\d+-AS\d+)\b/g

export function verificationFrom(cases: JunitCase[], anchors: Anchor[], fingerprints: Record<string, string>, featureDir: string | null, at: string, commit: string): Record<string, Verification> {
  const byId = new Map<string, { failed: boolean; passed: boolean; tests: Set<string> }>()
  for (const c of cases) {
    if (c.status === 'skipped') continue
    const ids = new Set([...`${c.name} ${c.classname}`.matchAll(IDS)].map(m => m[0]))
    for (const a of anchors) {
      const id = a.file === c.file && c.file ? localId(a.id, featureDir) : null
      if (id) ids.add(id)
    }
    const label = c.classname ? `${c.classname}.${c.name}` : c.name
    for (const id of ids) {
      const entry = byId.get(id) ?? { failed: false, passed: false, tests: new Set<string>() }
      if (c.status === 'failed') entry.failed = true
      else entry.passed = true
      entry.tests.add(label)
      byId.set(id, entry)
    }
  }
  const out: Record<string, Verification> = {}
  for (const [id, e] of byId) {
    out[id] = { status: e.failed ? 'failing' : 'passing', tests: [...e.tests].sort(byCodePoint).slice(0, 10), at, commit, fingerprint: fingerprints[id] ?? '' }
  }
  return out
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Without JUnit: a suite that exits 0 proves every requirement that has a real test; a failing one proves nothing. */
export function verificationFromExit(exitCode: number, ids: string[], fingerprints: Record<string, string>, at: string, commit: string): Record<string, Verification> {
  if (exitCode !== 0) return {}
  return Object.fromEntries(ids.map(id => [id, { status: 'passing' as const, tests: ['<suite>'], at, commit, fingerprint: fingerprints[id] ?? '' }]))
}
