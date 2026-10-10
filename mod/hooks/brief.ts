// What a step is handed beyond "run the command" (0.5.2): the phase's own goal, independent test and checkpoint from
// tasks.md, the acceptance scenarios it has to prove, the quickstart rows and screens that show them, the last test
// run and the project's runbook. And what "done" means: a verification that still holds for this spec, these tasks
// and this working tree. Pure: register.tsx reads the files.

import type { Autopilot, NextWork, PhaseNote, QuickRow, Snapshot } from '../types'
import { designDir } from './design'
import { fingerprint, specFingerprint } from './rules'

export const RUNBOOK = '.specify/memory/runbook.md'
const MAX_RUNBOOK = 1500

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)
const plain = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '').trim()

/** tasks.md's notes per `##` phase: `**Goal**:`, `**Independent Test**:`, `**Checkpoint**:`, keyed by the heading. */
export function parsePhaseNotes(tasksMd: string): Record<string, PhaseNote> {
  const notes: Record<string, PhaseNote> = {}
  const lines = tasksMd.split('\n')
  // A field is a paragraph: the lines after it belong to it until a blank line or the next structure.
  const structure = /^\s*(#|[-*+]\s|\d+[.)]\s|\||```|~~~|\*\*[^*]+\*\*\s*:)/
  let phase: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      phase = plain(heading[1] ?? '')
      continue
    }
    const field = /^\s*\*\*(Goal|Purpose|Independent Test|Checkpoint)\*\*\s*:\s*(.+)$/i.exec(line)
    if (!phase || !field) continue
    let text = field[2]!.trim()
    while (i + 1 < lines.length && lines[i + 1]!.trim() && !structure.test(lines[i + 1]!)) text += ' ' + lines[++i]!.trim()
    const note = (notes[phase] ??= { goal: null, test: null, checkpoint: null })
    const key = field[1]!.toLowerCase()
    const value = clip(plain(text), 300)
    if (key === 'goal' || key === 'purpose') note.goal ??= value
    else if (key === 'independent test') note.test ??= value
    else note.checkpoint ??= value
  }
  return notes
}

const IDS = /\b(?:US\d+(?:-AS\d+)?|(?:FR|SC)-\d{3,}|Q\d+)\b/g

/** quickstart.md's table rows that name a story, a scenario or a requirement: the runnable checks of the feature. */
export function parseQuickstart(markdown: string): QuickRow[] {
  const rows: QuickRow[] = []
  for (const line of markdown.split('\n')) {
    if (!/^\s*\|/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => plain(c))
    const ids = [...new Set(line.match(IDS) ?? [])].filter(id => !/^Q\d+$/.test(id))
    if (!ids.length || cells.every(c => !c)) continue
    rows.push({ ids, text: clip(cells.filter(Boolean).join(' · '), 200) })
  }
  return rows
}

/** The phase brief of an implement step: what the phase is for, what proves it, and when it is done. */
export function phaseBrief(snap: Snapshot, phase: string, lastTest: Autopilot['lastTest'] = null): string[] {
  const note = snap.phaseNotes?.[phase]
  const stories = [...new Set(snap.tasks.filter(t => t.phase === phase && t.story).map(t => t.story!))]
  const scenarios = (snap.spec?.stories ?? []).filter(s => stories.includes(s.id)).flatMap(s => s.scenarios)
  const ids = new Set([...stories, ...scenarios.map(s => s.id)])
  const rows = (snap.quickstart ?? []).filter(r => r.ids.some(id => ids.has(id)))
  const screens = (snap.design?.screens ?? []).filter(s => s.serves.some(id => ids.has(id) || stories.some(st => id.startsWith(`${st}-`))))
  const lines: string[] = []
  if (note?.goal) lines.push(`Goal: ${note.goal}`)
  if (note?.test) lines.push(`Independent test: ${note.test}`)
  if (scenarios.length) {
    lines.push(`Prove: ${scenarios.map(s => `${s.id} "${clip(s.text, 110)}"`).join('; ')}. Name each test after the scenario it proves (its id in the test name).`)
  }
  if (rows.length) lines.push(`Quickstart: ${rows.slice(0, 4).map(r => r.text).join(' | ')}`)
  if (screens.length && snap.featureDir) {
    lines.push(`Screens: ${screens.map(s => `${s.name}${s.mock ? ` (${designDir(snap.featureDir!)}/${s.mock})` : ''}`).join(', ')}; build them to DESIGN.md.`)
  }
  if (lastTest) lines.push(`Last test run: ${lastTest.ok ? 'green' : `red: ${clip(lastTest.output.trim().split('\n').at(-1) ?? '', 140)}`}.`)
  if (note?.checkpoint) lines.push(`Done when: ${note.checkpoint}. Check that before you end the step, and say how you checked it.`)
  return lines.length ? ['Phase brief (tasks.md, spec.md, quickstart.md):', ...lines.map(l => `- ${l}`)] : []
}

/** The runbook as a note: what earlier steps learned about this project's environment. */
export function runbookNote(runbook: string | null | undefined): string | null {
  const text = (runbook ?? '').trim()
  if (!text) return null
  const tail = text.length > MAX_RUNBOOK ? '…' + text.slice(-MAX_RUNBOOK) : text
  return `Runbook (${RUNBOOK}, what earlier steps learned about this project's environment):\n${tail}`
}

/**
 * What a verification holds for: this spec, these tasks, this commit and these uncommitted changes. While it holds the
 * feature is done, and another verify would only say the same again.
 */
export function verifyKey(snap: Snapshot, tasksFp: string): string {
  return fingerprint([snap.spec ? specFingerprint(snap.spec) : '', tasksFp, snap.head ?? '', snap.tree ?? ''].join('|'))
}

/** `git status --porcelain` without the ledger's own file, which the mod rewrites as it links. */
export const treeOf = (porcelain: string) => fingerprint(porcelain.split('\n').filter(l => l.trim() && !/(^|\/)xref\.json$/.test(l.trim())).sort().join('\n'))

export const NEXT_LABELS = [
  'a new feature, separate from the finished one',
  'a change to what the finished feature does',
  'a bug: something the finished feature does wrong',
  'no new work: a question or a remark',
] as const
/** The kind of work a label names; null for a question or a remark, which stays a conversation. */
export const nextKindOf = (label: string): NextWork['kind'] | null =>
  label === NEXT_LABELS[0] ? 'feature' : label === NEXT_LABELS[1] ? 'change' : label === NEXT_LABELS[2] ? 'bug' : null

/** What the person is asked once a feature is done; with a kind chosen in the pane, only its words are missing. */
export function doneAsk(kind: NextWork['kind'] | null | undefined): string {
  if (kind === 'feature') return 'Describe the new feature in your own words; the autopilot specifies it as the next feature.'
  if (kind === 'change') return 'Describe the change in your own words; the autopilot folds it into the spec and builds it.'
  if (kind === 'bug') return 'Describe the bug: what you did, what happened, what you expected; the autopilot reproduces and fixes it.'
  return 'The feature is done. Say what comes next (a new feature, a change to this one, or a bug), or press New feature, Change or Bug in the pane.'
}

/** The bug step: Spec Kit's bug extension where it is installed, else the same three steps by hand. */
export function bugPrompt(snap: Snapshot, text: string, command: (name: string) => string, has: (name: string) => boolean): string {
  const steps = has('bug-assess')
    ? [`Run ${command('bug.assess')} with the report below, then ${command('bug.fix')}, then ${command('bug.test')}, each through the Skill tool, without asking in between.`]
    : [
        'Reproduce it first: find the code path, and write a test that fails because of the bug, named after the requirement or scenario it breaks (FR-###, USn-ASm).',
        'Then fix the code (not the test), and run the tests until they pass.',
        'Record it in .specify/bugs/<slug>/report.md: symptom, cause, fix, the test that proves it.',
      ]
  return [
    `A bug in ${snap.featureDir}, in the person's words: "${text}"`,
    ...steps,
    `Append a checked task for it to ${snap.featureDir}/tasks.md under '## Phase N: Fixes' (the next free T### id, the files in backticks, the requirement ids), so the fix has its place in the trace.`,
  ].join('\n')
}

/** The change step: the request reaches the spec first, then the tasks it needs. */
export function changePrompt(snap: Snapshot, text: string, revise: string | null): string {
  return [
    revise
      ? `Run ${revise} through the Skill tool with this change request from the person: "${text}".`
      : `The person asks for a change to ${snap.featureDir}: "${text}". Fold it into spec.md first: new requirements under the next free FR-### ids, a changed one marked SUPERSEDED by its successor.`,
    `Then append the tasks it needs to ${snap.featureDir}/tasks.md under '## Phase N: Changes' (the next free T### ids, files in backticks, requirement ids). Do not implement them in this step.`,
  ].join('\n')
}
