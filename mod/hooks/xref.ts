// Pure X-Ref and drift logic: which task a file serves, what counts as drift, what the model is told.

import type { Anchor, Ledger, Semantic, Snapshot, Spec, Task } from '../types'
import { emptyLedger } from './ledger'
import { LADDER, isActive, isStale, levelOf } from './proof'
import type { Rung } from './proof'
import { fingerprint, isTestFile, localId, matchesAny } from './rules'
import type { Rules } from './rules'

export { emptyLedger, localId }

/** The verdicts of docs/contract-0.4.md §3, in the order they are tried. */
export type CoreVerdict = 'spec' | 'exempt' | 'task-linked' | 'planned' | 'linked' | 'unclear' | 'untracked' | 'unplanned'
export type Verdict = 'in-scope' | 'other-task' | 'linked' | 'unplanned' | 'untracked' | 'spec' | 'exempt' | 'unclear'
export type Classified = { verdict: Verdict; task: string | null }

export type Level = 'none' | 'green' | 'yellow' | 'red'
export type Finding = {
  kind: 'unplanned' | 'dangling' | 'orphan-test' | 're-verify' | 'semantic' | 'intent'
  level: 'yellow' | 'red'
  text: string
  file?: string
  intent?: string
  id?: string
}
export type Report = {
  level: Level
  findings: Finding[]
  /** Active FRs at `planned` or above. */
  covered: number
  total: number
  uncovered: string[]
  done: number
  tasks: number
  levels: Record<Rung, number>
  /** Spec gaps that do not raise the drift level. */
  notes: string[]
}

/** A text cut at a word boundary, an ellipsis where it was cut. */
export function short(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:(]+$/, '') + '…'
}

const MAX_UNPLANNED = 100
const MAX_INTENTS = 50

export function relPath(file: string, root: string): string {
  let path = file.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (base && path.startsWith(base + '/')) path = path.slice(base.length + 1)
  return path.replace(/^\.\//, '')
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Spec Kit's own files and the agent's configuration are never drift; CI workflows are code. */
export const isSpecArtifact = (rel: string) =>
  (/^(specs|\.specify|\.claude|\.github)\//.test(rel) && !/^\.github\/workflows\//.test(rel)) || /^(CLAUDE|AGENTS)\.md$/.test(rel)

export function pathMatches(rel: string, planned: string): boolean {
  const p = planned.replace(/^\.\//, '')
  if (rel === p) return true
  if (p.endsWith('/')) return rel.startsWith(p)
  if (rel.endsWith('/' + p)) return true
  if (!p.includes('/') && !p.includes('.')) return false
  if (rel.startsWith(p + '/')) return true
  return !p.includes('/') && basename(rel) === p
}

/** Whether a task plans a file: a file it names always; a folder it names only while the task is open. */
export function plans(task: Task, rel: string): boolean {
  return task.paths.some(p => {
    const isFolder = p.endsWith('/') || rel.startsWith(p.replace(/^\.\//, '') + '/')
    return pathMatches(rel, p) && (!isFolder || !task.done)
  })
}

export const ANCHOR = /@spec\s+((?:[\w.-]+\/)?(?:(?:FR|SC)-\d{3,}|T-?\d{3,}|US\d+-AS\d+))/g

export function anchorsIn(text: string, file: string): Anchor[] {
  const out: Anchor[] = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ANCHOR)) out.push({ id: m[1] ?? '', file, line: i + 1 })
  })
  return out
}

const DEFAULT_RULES: Rules = { exempt: [], unclear: [] }

/** The shared classification (§3): first match wins. The extension's batch check reports these verdicts as they are. */
export function classifyCore(
  rel: string,
  snap: Pick<Snapshot, 'tasks'>,
  ledger: Ledger,
  rules: Rules = DEFAULT_RULES,
  newText = '',
): { verdict: CoreVerdict; task: string | null } {
  if (isSpecArtifact(rel)) return { verdict: 'spec', task: null }
  if (matchesAny(rel, rules.exempt)) return { verdict: 'exempt', task: null }
  for (const [id, entry] of Object.entries(ledger.tasks)) if (entry.linked.includes(rel)) return { verdict: 'task-linked', task: id }
  // The task that plans a file comes before its anchors: it says which task the work is on.
  const matches = snap.tasks.filter(t => plans(t, rel))
  const match = matches.find(t => !t.done) ?? matches[0]
  if (match) return { verdict: 'planned', task: match.id }
  if (newText && anchorsIn(newText, rel).length > 0) return { verdict: 'linked', task: null }
  if (Object.values(ledger.requirements).some(r => r.files.includes(rel))) return { verdict: 'linked', task: null }
  if (ledger.anchors.some(a => a.file === rel)) return { verdict: 'linked', task: null }
  if (matchesAny(rel, rules.unclear)) return { verdict: 'unclear', task: null }
  if (snap.tasks.length === 0) return { verdict: 'untracked', task: null }
  return { verdict: 'unplanned', task: null }
}

/** The live verdict: a planned file is in scope for the task in focus, or moves the focus to its own task. */
export function classify(rel: string, snap: Snapshot, ledger: Ledger, active: string | null, newText = ''): Classified {
  const core = classifyCore(rel, snap, ledger, snap.rules, newText)
  switch (core.verdict) {
    case 'task-linked':
      return { verdict: 'linked', task: core.task }
    case 'planned': {
      const own = active ? snap.tasks.find(t => t.id === active && plans(t, rel)) : undefined
      if (own) return { verdict: 'in-scope', task: own.id }
      return { verdict: active ? 'other-task' : 'in-scope', task: core.task }
    }
    case 'linked':
    case 'unplanned':
    case 'unclear':
      return { verdict: core.verdict, task: active }
    default:
      return { verdict: core.verdict, task: null }
  }
}

/** Books one finished write into the ledger; returns the ledger it became. */
export function recordTouch(ledger: Ledger, rel: string, c: Classified, at: string): Ledger {
  const next: Ledger = { ...ledger, tasks: { ...ledger.tasks }, unplanned: ledger.unplanned }
  // Exempt and unclear files are no evidence for a task and no drift either.
  if (c.task && c.verdict !== 'unplanned' && c.verdict !== 'exempt' && c.verdict !== 'unclear') {
    const entry = next.tasks[c.task] ?? { touched: [], linked: [] }
    if (!entry.touched.includes(rel)) next.tasks[c.task] = { ...entry, touched: [...entry.touched, rel] }
  }
  if (c.verdict === 'unplanned' && !ledger.unplanned.some(u => u.file === rel && !u.acknowledged)) {
    next.unplanned = [...ledger.unplanned, { file: rel, at, task: c.task, acknowledged: false }].slice(-MAX_UNPLANNED)
  }
  return next
}

/** Ties a file to a task or requirement; a file once unplanned stops counting. */
export function link(ledger: Ledger, rel: string, id: string, snap: Snapshot, source = 'link'): { ledger: Ledger; error?: string } {
  const bare = localId(id, snap.featureDir)
  if (!bare) return { ledger, error: `${id} names another feature than ${snap.featureDir ?? 'the active one'}` }
  const next: Ledger = { ...ledger, tasks: { ...ledger.tasks }, requirements: { ...ledger.requirements } }
  if (/^T\d{3,}$/.test(bare)) {
    if (!snap.tasks.some(t => t.id === bare)) return { ledger, error: `${bare} is no task in tasks.md` }
    const entry = next.tasks[bare] ?? { touched: [], linked: [] }
    if (!entry.linked.includes(rel)) next.tasks[bare] = { ...entry, linked: [...entry.linked, rel] }
  } else if (/^(FR|SC)-\d{3,}$/.test(bare) || /^US\d+-AS\d+$/.test(bare)) {
    const known = snap.spec?.reqs.some(r => r.id === bare) || snap.spec?.stories.some(s => s.scenarios.some(x => x.id === bare))
    if (!known) return { ledger, error: `${bare} is no requirement or acceptance scenario in spec.md` }
    const entry = next.requirements[bare] ?? { tasks: [], files: [], sources: [] }
    next.requirements[bare] = {
      ...entry,
      files: entry.files.includes(rel) ? entry.files : [...entry.files, rel],
      sources: entry.sources.includes(source) ? entry.sources : [...entry.sources, source],
    }
  } else {
    return { ledger, error: `${id} is neither a task (T###), a requirement (FR-### / SC-###) nor a scenario (US1-AS1)` }
  }
  next.unplanned = ledger.unplanned.map(u => (u.file === rel ? { ...u, acknowledged: true } : u))
  // The text a link was made against: when it changes, the link needs new proof.
  const req = snap.spec?.reqs.find(r => r.id === bare)
  if (req) next.fingerprints = { ...ledger.fingerprints, [bare]: fingerprint(req.text) }
  return { ledger: next }
}

export function logIntent(ledger: Ledger, text: string, task: string | null, at: string): Ledger {
  return { ...ledger, intents: [...ledger.intents, { at, text: text.slice(0, 500), task, status: 'logged' as const }].slice(-MAX_INTENTS) }
}

export function acknowledgeAll(ledger: Ledger): Ledger {
  return { ...ledger, unplanned: ledger.unplanned.map(u => ({ ...u, acknowledged: true })) }
}

/** Whether a logged prompt and a change the check quoted from it are the same request. */
const quotes = (logged: string, quoted: string) => logged.includes(quoted) || quoted.includes(logged.slice(0, 40))

export function resolveIntent(ledger: Ledger, text: string): Ledger {
  const semantic = ledger.semantic ? { ...ledger.semantic, changes: ledger.semantic.changes.filter(c => c.text !== text) } : null
  return { ...ledger, semantic, intents: ledger.intents.map(i => (i.status !== 'resolved' && quotes(i.text, text) ? { ...i, status: 'resolved' as const } : i)) }
}

/** The task in focus while it is open; once it is checked off, the first open one. */
export function currentTask(snap: Snapshot, active: string | null): Task | null {
  const chosen = active ? snap.tasks.find(t => t.id === active && !t.done) : undefined
  return chosen ?? snap.tasks.find(t => !t.done) ?? null
}

/** What the ladder reads from a snapshot. */
const proofSnap = (snap: Snapshot) => ({ featureDir: snap.featureDir, tasks: snap.tasks, reqs: snap.spec?.reqs ?? [], realTests: snap.realTests ?? [] })

/**
 * The drift report (§8). Only deterministic findings decide unless `semantic` is on: the live mod lets the
 * intent check count, the extension's exit code never does.
 */
export function evaluate(snap: Snapshot, ledger: Ledger, opts: { semantic?: boolean } = {}): Report {
  const semanticOn = opts.semantic ?? true
  const findings: Finding[] = []
  const open = ledger.unplanned.filter(u => !u.acknowledged)
  for (const u of open) findings.push({ kind: 'unplanned', level: 'yellow', file: u.file, text: `${u.file} is not planned for any task` })
  if (open.length >= 3) findings.push({ kind: 'unplanned', level: 'red', text: `${open.length} edits outside the planned files` })

  const reqs = snap.spec?.reqs ?? []
  const byId = new Map(reqs.map(r => [r.id, r]))
  const known = new Set([...reqs.filter(r => isActive(r)).map(r => r.id), ...snap.tasks.map(t => t.id), ...(snap.spec?.stories.flatMap(s => s.scenarios.map(x => x.id)) ?? [])])
  for (const a of ledger.anchors) {
    const bare = localId(a.id, snap.featureDir)
    if (!bare || known.has(bare)) continue
    const old = byId.get(bare)
    const why = old ? (old.supersededBy ? `superseded by ${old.supersededBy}` : 'retired') : 'which the spec no longer has'
    const test = isTestFile(a.file)
    findings.push({
      kind: test ? 'orphan-test' : 'dangling',
      level: 'yellow',
      file: a.file,
      id: bare,
      text: test ? `${a.file}:${a.line} tests ${a.id}, ${old ? `which is ${why}` : why}` : `${a.file}:${a.line} anchors ${a.id}, ${old ? `which is ${why}` : why}`,
    })
  }
  const proof = proofSnap(snap)
  for (const r of reqs) {
    if (isActive(r) && isStale(r.id, proof, ledger)) findings.push({ kind: 're-verify', level: 'yellow', id: r.id, text: `${r.id} changed since it was last proven; it needs new proof` })
  }

  const s = ledger.semantic
  if (s && semanticOn) {
    if (s.verdict === 'drift' || s.score < 50) findings.push({ kind: 'semantic', level: 'red', text: `Intent check ${s.score}/100: ${s.reasons[0] ?? 'the change drifts from the spec'}` })
    else if (s.verdict === 'minor' || s.score < 80) findings.push({ kind: 'semantic', level: 'yellow', text: `Intent check ${s.score}/100: ${s.reasons[0] ?? 'minor drift'}` })
    for (const c of s.changes) {
      findings.push({ kind: 'intent', level: c.kind === 'contradicts' ? 'red' : 'yellow', intent: c.text, text: `User asked: "${c.text}", ${c.kind === 'contradicts' ? 'which contradicts the spec' : 'which the spec does not cover'}` })
    }
  }

  const frs = reqs.filter(r => r.kind === 'FR' && isActive(r))
  const levels = Object.fromEntries(LADDER.map(r => [r, 0])) as Record<Rung, number>
  const uncovered: string[] = []
  for (const r of frs) {
    const rung = levelOf(r.id, proof, ledger)
    levels[rung] += 1
    if (rung === 'specified') uncovered.push(r.id)
  }
  const notes = (snap.spec?.stories ?? []).filter(st => st.scenarios.length === 0).map(st => `${st.id} has no acceptance scenarios`)
  const level: Level = !snap.featureDir ? 'none' : findings.some(f => f.level === 'red') ? 'red' : findings.length ? 'yellow' : 'green'
  return {
    level,
    findings,
    covered: frs.length - uncovered.length,
    total: frs.length,
    uncovered,
    done: snap.tasks.filter(t => t.done).length,
    tasks: snap.tasks.length,
    levels,
    notes,
  }
}

/** The FRs a task serves: named in its text, or mapped to it in the ledger. */
export function reqsOf(task: Task, ledger: Ledger): string[] {
  const mapped = Object.entries(ledger.requirements).filter(([, r]) => r.tasks.includes(task.id)).map(([id]) => id)
  return [...new Set([...task.reqs, ...mapped])]
}

/** How the project invokes a Spec Kit command: `xref.map` is `/speckit-xref-map` for skills, `/speckit.xref.map` for commands. */
export const speckitCommand = (snap: Snapshot, name: string) =>
  snap.commandStyle === 'skills' ? `/speckit-${name.replace(/\./g, '-')}` : `/speckit.${name}`

/**
 * The system prompt section: the active spec and the rules that keep the work on it.
 * It changes only when the spec does, so the conversation's prompt cache survives task switches;
 * the current task and the drift status ride each prompt instead (turnContext).
 */
export function composeSection(snap: Snapshot, mode: string, plugin: string): string | null {
  if (!snap.featureDir || !snap.spec) return null
  const spec = snap.spec
  const lines: string[] = [
    '# Spec Kit cross-reference (speckit-xref)',
    'This repository follows GitHub Spec Kit. Keep the work inside the active spec and say so when it would leave it.',
    '',
    `Active feature: ${snap.featureDir} — ${spec.title}`,
  ]
  if (spec.input) lines.push(`The user's original words: "${spec.input}"`)
  if (spec.stories.length) lines.push(`User stories: ${spec.stories.map(s => `${s.id}${s.priority ? ` (${s.priority})` : ''} ${s.title}`).join(' | ')}`)
  if (snap.constitution?.musts.length) lines.push('Constitution, MUST rules:', ...snap.constitution.musts.slice(0, 8).map(m => `- ${m}`))
  if (spec.outOfScope.length) lines.push('Out of scope:', ...spec.outOfScope.map(o => `- ${o}`))
  const clar = spec.reqs.filter(r => r.needsClarification).map(r => r.id)
  if (clar.length) lines.push(`Still marked NEEDS CLARIFICATION: ${clar.join(', ')}. Ask the user before implementing them.`)
  lines.push(
    '',
    'Rules:',
    `- Before editing a file the current task does not plan, name the task or requirement it serves; call mcp__${plugin}__focus to switch tasks or mcp__${plugin}__link to tie the file to one.`,
    `- When the user asks for something the spec does not cover or contradicts, say so plainly and offer to update the spec (${speckitCommand(snap, 'clarify')}) before building it.`,
    '- Check a task off in tasks.md ([X]) only once the requirements it serves are met.',
    `- Mark code that implements a requirement with a comment at file or function level: @spec ${basename(snap.featureDir)}/FR-###.`,
    '- Each user prompt carries a "speckit-xref" note with the current task and the drift status; follow it.',
  )
  if (mode === 'strict') lines.push("- Strict mode: edits outside the current task's planned or linked files are refused until you focus another task or link the file.")
  return lines.join('\n')
}

/** The note beside a user's prompt: the current task, what it serves, and the drift status right now. */
export function turnContext(snap: Snapshot, ledger: Ledger, active: string | null, next?: string): string | null {
  if (!snap.featureDir || !snap.spec) return null
  const report = evaluate(snap, ledger)
  const task = currentTask(snap, active)
  const lines = [`speckit-xref · ${snap.featureDir} · tasks ${report.done}/${report.tasks} · FR covered ${report.covered}/${report.total} · drift ${report.level}`]
  if (task) {
    lines.push(`Current task: ${task.id}${task.story ? ` [${task.story}]` : ''} ${task.text}`)
    if (task.paths.length) lines.push(`Planned files: ${task.paths.join(', ')}`)
    const reqs = reqsOf(task, ledger)
    if (reqs.length) {
      const byId = new Map(snap.spec.reqs.map(r => [r.id, r.text]))
      lines.push('Serves:', ...reqs.map(id => `- ${id}: ${byId.get(id) ?? ''}`))
    }
    const next = snap.tasks.filter(t => !t.done && t.id !== task.id).slice(0, 3)
    if (next.length) lines.push(`Next: ${next.map(t => `${t.id} ${short(t.text, 80)}`).join(' | ')}`)
  } else if (snap.tasks.length === 0) {
    lines.push(`No tasks.md yet; ${speckitCommand(snap, 'tasks')} derives them from the plan.`)
  } else {
    lines.push('Every task in tasks.md is checked.')
  }
  if (report.findings.length) lines.push('Drift:', ...report.findings.slice(0, 5).map(f => `- ${f.text}`))
  if (next) lines.push(`Next Spec Kit step: ${next}`)
  return lines.join('\n')
}

/** What the model reads beside a write's result when the write left the plan, or moved to another task. */
export function editNote(rel: string, c: Classified, snap: Snapshot, previous: string | null, plugin: string): string | null {
  if (c.verdict === 'unplanned') {
    const task = currentTask(snap, previous)
    const planned = task?.paths.length ? ` (it plans ${task.paths.join(', ')})` : ''
    return `speckit-xref: ${rel} is not planned for ${task ? `the current task ${task.id}${planned}` : 'any task'}. If it serves the spec, call mcp__${plugin}__link with the task or requirement; if the user asked for it beyond the spec, tell them and offer ${speckitCommand(snap, 'clarify')}.`
  }
  if (c.verdict === 'other-task' && c.task && c.task !== previous) {
    const task = snap.tasks.find(t => t.id === c.task)
    if (task?.done) return `speckit-xref: ${rel} belongs to ${c.task}, which is checked off: this is rework on a finished task.`
    return `speckit-xref: ${rel} belongs to ${c.task}${task ? ` (${task.text.slice(0, 80)})` : ''}; that is now the current task.`
  }
  return null
}

/** The question the drift check asks over the session's own transcript. */
export function forkPrompt(snap: Snapshot, ledger: Ledger, active: string | null, changed: string[], diff: string, withLog = false): string {
  const spec = snap.spec
  // Without the transcript (a check run before the session's first turn) the logged prompts stand in for the user's words.
  const said = withLog ? ledger.intents.filter(i => i.status !== 'resolved').slice(-10).map(i => `- ${i.text}`) : []
  const task = currentTask(snap, active)
  const reqs = spec?.reqs.map(r => `${r.id}: ${r.text}`).join('\n') ?? '(no spec)'
  return [
    'You are auditing this session for drift. Do not call any tool. Answer with ONE JSON object and nothing else.',
    'Compare (1) what the user asked for in this conversation, in their own words, (2) the active Spec Kit spec below, and (3) the files changed in the last turn.',
    '',
    `Spec: ${spec?.title ?? '-'} (${snap.featureDir ?? '-'})`,
    `Original request: ${spec?.input ?? '-'}`,
    `Requirements:\n${reqs}`,
    `Out of scope: ${spec?.outOfScope.join('; ') || '-'}`,
    `Current task: ${task ? `${task.id} ${task.text}` : '-'}`,
    ...(said.length ? ['What the user said in this session, oldest first:', ...said] : []),
    `Changed files: ${changed.join(', ') || '-'}`,
    `Diff (may be cut):\n${diff.slice(0, 6000) || '(no diff available)'}`,
    '',
    'JSON shape: {"score": 0-100 (100 = the change matches both the user\'s intent and the spec), "verdict": "aligned" | "minor" | "drift", "reasons": ["at most 3 short reasons"], "intent_changes": [{"text": "a short quote of something the user asked for during the session that the spec does not cover or contradicts", "kind": "extends" | "contradicts"}]}',
    'intent_changes holds only requests the user made, never the spec\'s own text; code that contradicts the spec without the user asking for it belongs in reasons and the score. An empty list is the normal answer.',
  ].join('\n')
}

/** The first JSON object in a model reply. */
function firstJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export function parseSemantic(text: string, at: string): Semantic | null {
  const raw = firstJson(text) as Record<string, unknown> | null
  if (!raw || typeof raw.score !== 'number') return null
  const verdict = raw.verdict === 'aligned' || raw.verdict === 'minor' || raw.verdict === 'drift' ? raw.verdict : raw.score >= 80 ? 'aligned' : raw.score >= 50 ? 'minor' : 'drift'
  const reasons = Array.isArray(raw.reasons) ? raw.reasons.filter((r): r is string => typeof r === 'string').slice(0, 3) : []
  const changes = Array.isArray(raw.intent_changes)
    ? raw.intent_changes
        .filter((c): c is { text: string; kind?: string } => !!c && typeof (c as { text?: unknown }).text === 'string')
        .map(c => ({ text: c.text.slice(0, 200), kind: c.kind === 'contradicts' ? ('contradicts' as const) : ('extends' as const) }))
        .slice(0, 5)
    : []
  return { score: Math.max(0, Math.min(100, Math.round(raw.score))), verdict, reasons, changes, at }
}

export function applySemantic(ledger: Ledger, semantic: Semantic): Ledger {
  // A change the user already resolved stays resolved when a later check quotes it again.
  const resolved = ledger.intents.filter(i => i.status === 'resolved')
  const changes = semantic.changes.filter(c => !resolved.some(i => quotes(i.text, c.text)))
  const intents = ledger.intents.map(i => {
    const hit = changes.find(c => i.status === 'logged' && quotes(i.text, c.text))
    return hit ? { ...i, status: hit.kind } : i
  })
  return { ...ledger, intents, semantic: { ...semantic, changes } }
}

export function mapPrompt(spec: Spec, tasks: Task[]): string {
  return [
    'Map each functional requirement of a Spec Kit feature to the tasks that implement it. Answer with ONE JSON object and nothing else:',
    '{"FR-001": ["T004", "T005"], ...}. Use only ids listed below; a requirement no task serves maps to [].',
    '',
    'Requirements:',
    ...spec.reqs.filter(r => r.kind === 'FR').map(r => `${r.id}: ${r.text}`),
    '',
    'Tasks:',
    ...tasks.map(t => `${t.id}${t.story ? ` [${t.story}]` : ''}: ${t.text}`),
  ].join('\n')
}

export function applyMapping(ledger: Ledger, text: string, snap: Snapshot): { ledger: Ledger; mapped: number } {
  const raw = firstJson(text) as Record<string, unknown> | null
  if (!raw) return { ledger, mapped: 0 }
  const reqIds = new Set(snap.spec?.reqs.map(r => r.id) ?? [])
  const taskIds = new Set(snap.tasks.map(t => t.id))
  const requirements = { ...ledger.requirements }
  const fingerprints = { ...ledger.fingerprints }
  let mapped = 0
  for (const [id, value] of Object.entries(raw)) {
    if (!reqIds.has(id) || !Array.isArray(value)) continue
    const tasks = value.filter((t): t is string => typeof t === 'string' && taskIds.has(t))
    const entry = requirements[id] ?? { tasks: [], files: [], sources: [] }
    requirements[id] = { ...entry, tasks: [...new Set([...entry.tasks, ...tasks])], sources: entry.sources.includes('llm') ? entry.sources : [...entry.sources, 'llm'] }
    if (tasks.length) {
      mapped += 1
      const req = snap.spec?.reqs.find(r => r.id === id)
      if (req) fingerprints[id] = fingerprint(req.text)
    }
  }
  return { ledger: { ...ledger, requirements, fingerprints }, mapped }
}

export const REMEDIATION_HEADING = '## Drift Remediation (speckit-xref)'

/** tasks.md with one more open task under the remediation heading, numbered after the highest T###. */
export function appendRemediation(tasksMd: string, tasks: Task[], text: string): { markdown: string; id: string } {
  const highest = tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(1)) || 0), 0)
  const width = Math.max(3, tasks[0]?.id.length ? tasks[0].id.length - 1 : 3)
  const id = 'T' + String(highest + 1).padStart(width, '0')
  const line = `- [ ] ${id} [Drift] ${text.replace(/\s+/g, ' ').trim()}`
  const base = tasksMd.replace(/\s*$/, '')
  const markdown = base.includes(REMEDIATION_HEADING) ? `${base}\n${line}\n` : `${base}\n\n${REMEDIATION_HEADING}\n\n${line}\n`
  return { markdown, id }
}
