// The ledger's two files (docs/contract-0.4.md §1): what is committed and reviewed, what stays on this machine.

import type { Ledger, Semantic, Unplanned } from '../types'
import { fingerprint, specFingerprint } from './rules'
import { parseSpec } from './speckit'

/** 2 (0.5.0): requirement texts include their wrapped continuation lines (docs/contract-0.4.md §6). */
export const FINGERPRINT_VERSION = 2

export const emptyLedger = (): Ledger => ({
  tasks: {},
  requirements: {},
  unplanned: [],
  intents: [],
  anchors: [],
  semantic: null,
  semanticHistory: [],
  fingerprints: {},
  verification: {},
  approvals: {},
  decisions: [],
  checkpoints: {},
  fingerprintVersion: FINGERPRINT_VERSION,
  extra: { committed: {}, local: {} },
})

const COMMITTED_KEYS = new Set(['schema_version', 'feature', 'map', 'links', 'accepted', 'fingerprints', 'fingerprintVersion'])
const LOCAL_KEYS = new Set(['schema_version', 'feature', 'touched', 'unplanned', 'intents', 'semantic', 'semanticHistory', 'verification', 'approvals', 'decisions', 'anchors', 'checkpoints', 'fingerprintVersion'])
const MAX_HISTORY = 10

/** Where the local half lives: `.specify/xref/local/<feature-slug>.json`. */
export const localPath = (featureDir: string) => `.specify/xref/local/${featureDir.slice(featureDir.lastIndexOf('/') + 1)}.json`
export const runLogPath = (featureDir: string) => `.specify/xref/local/${featureDir.slice(featureDir.lastIndexOf('/') + 1)}.run.jsonl`
export const LOCAL_IGNORE = { path: '.specify/xref/.gitignore', text: 'local/\n' }

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const strs = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === 'string')
const parse = (text: string | null): Raw | null => {
  if (!text) return null
  try {
    return obj(JSON.parse(text))
  } catch {
    return null
  }
}
const others = (raw: Raw, known: Set<string>) => Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)))

/** A v1 ledger (one file, `schema_version` 1 or none) as the two v2 halves. */
export function migrateV1(v1: Raw): { committed: Raw; local: Raw } {
  const map: Record<string, string[]> = {}
  const links: Record<string, string[]> = {}
  const add = (file: string, id: string) => (links[file] = [...new Set([...(links[file] ?? []), id])].sort())
  for (const [id, r] of Object.entries(obj(v1.requirements))) {
    const entry = obj(r)
    const tasks = strs(entry.tasks)
    if (tasks.length) map[id] = [...new Set(tasks)].sort()
    for (const file of strs(entry.files)) add(file, id)
  }
  const touched: Record<string, string[]> = {}
  for (const [id, t] of Object.entries(obj(v1.tasks))) {
    const entry = obj(t)
    for (const file of strs(entry.linked)) add(file, id)
    if (strs(entry.touched).length) touched[id] = strs(entry.touched)
  }
  const unplanned = arr<Raw>(v1.unplanned)
  return {
    committed: {
      schema_version: 2,
      feature: v1.feature ?? null,
      map,
      links,
      accepted: [...new Set(unplanned.filter(u => u.acknowledged === true).map(u => String(u.file)))].sort(),
      fingerprints: {},
    },
    local: {
      schema_version: 2,
      feature: v1.feature ?? null,
      touched,
      unplanned: unplanned.filter(u => u.acknowledged !== true).map(u => ({ file: u.file, at: u.at, task: u.task ?? null })),
      intents: arr(v1.intents),
      semantic: v1.semantic ?? null,
      semanticHistory: [],
      verification: {},
      approvals: {},
      decisions: [],
      anchors: arr(v1.anchors),
    },
  }
}

/** The in-memory ledger from both files; a v1 file is migrated on the way in, the next write makes it v2. */
export function ledgerFromParts(committedText: string | null, localText: string | null): Ledger {
  let committed = parse(committedText) ?? {}
  let local = parse(localText) ?? {}
  // A file written before 0.5.0 carries no version: its fingerprints read one physical line per requirement.
  const versionOf = (half: Raw) => (typeof half.fingerprintVersion === 'number' ? half.fingerprintVersion : 1)
  const halves = [committedText ? committed : null, localText ? local : null].filter((h): h is Raw => h !== null)
  const version = halves.length ? Math.min(...halves.map(versionOf)) : FINGERPRINT_VERSION
  if (committedText && committed.schema_version !== 2) {
    const migrated = migrateV1(committed)
    committed = migrated.committed
    // A local file next to a v1 ledger is newer than the migration; it wins where it says something.
    local = { ...migrated.local, ...local }
  }
  const ledger = emptyLedger()
  for (const [id, tasks] of Object.entries(obj(committed.map))) {
    if (strs(tasks).length) ledger.requirements[id] = { tasks: strs(tasks), files: [], sources: ['map'] }
  }
  for (const [file, ids] of Object.entries(obj(committed.links))) {
    for (const id of strs(ids)) {
      if (/^T-?\d{3,}$/.test(id)) {
        const entry = (ledger.tasks[id] ??= { touched: [], linked: [] })
        if (!entry.linked.includes(file)) entry.linked.push(file)
      } else {
        const entry = (ledger.requirements[id] ??= { tasks: [], files: [], sources: [] })
        if (!entry.files.includes(file)) entry.files.push(file)
        if (!entry.sources.includes('link')) entry.sources.push('link')
      }
    }
  }
  for (const [id, files] of Object.entries(obj(local.touched))) {
    const entry = (ledger.tasks[id] ??= { touched: [], linked: [] })
    entry.touched = strs(files)
  }
  ledger.unplanned = [
    ...arr<Raw>(local.unplanned).map((u): Unplanned => ({ file: String(u.file), at: String(u.at ?? ''), task: typeof u.task === 'string' ? u.task : null, acknowledged: false })),
    ...strs(committed.accepted).map((file): Unplanned => ({ file, at: '', task: null, acknowledged: true })),
  ]
  ledger.fingerprints = Object.fromEntries(Object.entries(obj(committed.fingerprints)).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  ledger.intents = arr(local.intents)
  ledger.anchors = arr(local.anchors)
  ledger.semantic = (local.semantic as Semantic | null) ?? null
  ledger.semanticHistory = arr(local.semanticHistory)
  ledger.verification = obj(local.verification) as Ledger['verification']
  ledger.approvals = obj(local.approvals) as Ledger['approvals']
  ledger.decisions = arr(local.decisions)
  ledger.checkpoints = obj(local.checkpoints) as Ledger['checkpoints']
  ledger.fingerprintVersion = version
  ledger.extra = { committed: others(committed, COMMITTED_KEYS), local: others(local, LOCAL_KEYS) }
  return ledger
}

/** JSON with every object's keys sorted, so the committed file is the same bytes for the same state. */
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Raw).sort().map(k => [k, sortedJson((value as Raw)[k])]))
  return value
}
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort()

/** Both files' text for a ledger: the committed half deterministic and without timestamps. */
export function ledgerToParts(ledger: Ledger, featureDir: string): { committed: string; local: string } {
  const map: Record<string, string[]> = {}
  const links: Record<string, string[]> = {}
  const add = (file: string, id: string) => (links[file] = [...(links[file] ?? []), id])
  for (const [id, r] of Object.entries(ledger.requirements)) {
    if (r.tasks.length) map[id] = uniqSorted(r.tasks)
    for (const file of r.files) add(file, id)
  }
  const touched: Record<string, string[]> = {}
  for (const [id, t] of Object.entries(ledger.tasks)) {
    for (const file of t.linked) add(file, id)
    if (t.touched.length) touched[id] = t.touched
  }
  for (const file of Object.keys(links)) links[file] = uniqSorted(links[file]!)
  // An accepted file that was linked since is the link's, not an acceptance.
  const accepted = uniqSorted(ledger.unplanned.filter(u => u.acknowledged && !links[u.file]).map(u => u.file))
  const committed = sortedJson({
    ...ledger.extra.committed,
    schema_version: 2,
    feature: featureDir,
    map,
    links,
    accepted,
    fingerprints: ledger.fingerprints,
    fingerprintVersion: FINGERPRINT_VERSION,
  })
  const local = {
    ...ledger.extra.local,
    schema_version: 2,
    feature: featureDir,
    touched,
    unplanned: ledger.unplanned.filter(u => !u.acknowledged).map(u => ({ file: u.file, at: u.at, task: u.task })),
    intents: ledger.intents,
    semantic: ledger.semantic,
    semanticHistory: ledger.semanticHistory.slice(-MAX_HISTORY),
    verification: ledger.verification,
    approvals: ledger.approvals,
    decisions: ledger.decisions,
    anchors: ledger.anchors,
    checkpoints: ledger.checkpoints,
    fingerprintVersion: FINGERPRINT_VERSION,
  }
  return { committed: JSON.stringify(committed, null, 2) + '\n', local: JSON.stringify(local, null, 2) + '\n' }
}

/**
 * §6: a fingerprint stored by the pre-0.5.0 parser (one physical line per requirement) moves to today's text, and so
 * do the spec approval and the analyze checkpoint taken over that reading. Only a value equal to the old reading of
 * the same spec moves; any other stays, since it is a real change.
 */
export function rebaseline(ledger: Ledger, specMd: string | null): Ledger {
  if (ledger.fingerprintVersion >= FINGERPRINT_VERSION || !specMd) return { ...ledger, fingerprintVersion: FINGERPRINT_VERSION }
  const now = parseSpec(specMd)
  const old = parseSpec(specMd, { wrap: false })
  const oldText = new Map(old.reqs.map(r => [r.id, r.text]))
  const nowText = new Map(now.reqs.map(r => [r.id, r.text]))
  const moved = (id: string, stored: string) => (oldText.has(id) && nowText.has(id) && stored === fingerprint(oldText.get(id)!) ? fingerprint(nowText.get(id)!) : stored)
  const oldSpec = specFingerprint(old)
  const nowSpec = specFingerprint(now)
  return {
    ...ledger,
    fingerprints: Object.fromEntries(Object.entries(ledger.fingerprints).map(([id, fp]) => [id, moved(id, fp)])),
    verification: Object.fromEntries(Object.entries(ledger.verification).map(([id, v]) => [id, { ...v, fingerprint: moved(id, v.fingerprint) }])),
    approvals: ledger.approvals.spec === oldSpec ? { ...ledger.approvals, spec: nowSpec } : ledger.approvals,
    checkpoints: ledger.checkpoints.analyze === oldSpec ? { ...ledger.checkpoints, analyze: nowSpec } : ledger.checkpoints,
    fingerprintVersion: FINGERPRINT_VERSION,
  }
}
