// Where a project stands in Spec Kit's workflow, and the step that comes next. Pure: register.tsx hands in the snapshot.

import type { Ledger, Snapshot } from '../types'
import { evaluate, speckitCommand } from './xref'

export type Phase = 'setup' | 'constitution' | 'specify' | 'clarify' | 'plan' | 'tasks' | 'map' | 'implement' | 'verify'
export type Step = { phase: Phase; command: string | null; why: string; notes: string[] }

export function nextStep(snap: Snapshot, ledger: Ledger): Step {
  const notes: string[] = []
  const xref = snap.extensions.includes('xref')
  const step = (phase: Phase, command: string | null, why: string): Step => ({ phase, command, why, notes })

  if (!snap.initialized) return step('setup', null, 'Spec Kit is not set up in this repository (no .specify/).')
  if (!snap.constitution || snap.constitution.principles.length === 0) {
    return step('constitution', speckitCommand(snap, 'constitution'), 'The constitution is missing or still the template.')
  }
  if (!snap.featureDir || !snap.spec) return step('specify', speckitCommand(snap, 'specify'), 'No feature yet: describe what to build.')

  const unclear = snap.spec.reqs.filter(r => r.needsClarification).map(r => r.id)
  if (!snap.hasPlan) {
    if (unclear.length) return step('clarify', speckitCommand(snap, 'clarify'), `${unclear.join(', ')} still marked NEEDS CLARIFICATION; settle them before planning.`)
    return step('plan', speckitCommand(snap, 'plan'), 'The spec is written; plan.md is missing.')
  }
  if (unclear.length) notes.push(`${unclear.join(', ')} still marked NEEDS CLARIFICATION (${speckitCommand(snap, 'clarify')}).`)
  if (snap.tasks.length === 0) return step('tasks', speckitCommand(snap, 'tasks'), 'The plan is written; tasks.md is missing.')

  const report = evaluate(snap, ledger)
  if (report.level === 'red' || report.level === 'yellow') notes.push(`Drift ${report.level}: ${report.findings[0]?.text ?? ''}`)
  const mapped = Object.values(ledger.requirements).some(r => r.tasks.length > 0)
  const uncovered = report.uncovered.filter(id => !unclear.includes(id))
  if (uncovered.length && !mapped) {
    return step('map', xref ? speckitCommand(snap, 'xref.map') : '/xref map', `${uncovered.join(', ')} name no task yet; map requirements to tasks once.`)
  }
  const open = snap.tasks.filter(t => !t.done)
  if (open.length) {
    return step('implement', speckitCommand(snap, 'implement'), `${open.length} of ${snap.tasks.length} tasks open; next ${open[0]!.id}.`)
  }
  notes.push(`${speckitCommand(snap, 'converge')} finds work the tasks missed.`)
  return step('verify', xref ? speckitCommand(snap, 'xref.check') : '/xref check', 'Every task is checked: check the code against the spec.')
}

/** The step as one line, as the pane, /xref and the note on each prompt show it. */
export const stepLine = (s: Step) => (s.command ? `${s.command} · ${s.why}` : s.why)
