// Where a project stands in Spec Kit's workflow, the step that comes next, and the autopilot's rules. Pure: register.tsx hands in the snapshot.

import type { Autopilot, Ledger, Snapshot } from '../types'
import { evaluate, speckitCommand } from './xref'

export type Phase = 'setup' | 'integration' | 'constitution' | 'specify' | 'clarify' | 'plan' | 'tasks' | 'map' | 'implement' | 'verify'
export type Step = {
  phase: Phase
  command: string | null
  why: string
  notes: string[]
  /** Set when only the person can take this step: what they have to do. */
  needsUser: string | null
}

const INIT = 'init --here --force --non-interactive --integration claude'

/** How Spec Kit's CLI runs here: installed, or through uvx without installing. */
export const specifyCli = (snap: Snapshot) => (snap.tools.specify ? 'specify' : `uvx --from 'specify-cli>=1.1,<2' specify`)

export function nextStep(snap: Snapshot, ledger: Ledger, idea: string | null = null): Step {
  const notes: string[] = []
  const xref = snap.extensions.includes('xref')
  const step = (phase: Phase, command: string | null, why: string, needsUser: string | null = null): Step => ({ phase, command, why, notes, needsUser })

  if (!snap.initialized) {
    if (!snap.tools.specify && !snap.tools.uvx) {
      return step('setup', null, 'Spec Kit is not set up, and neither the specify CLI nor uvx is on this machine.', 'Install uv (https://docs.astral.sh/uv/) or the specify CLI (pipx install specify-cli).')
    }
    return step('setup', `${specifyCli(snap)} ${INIT}`, 'Spec Kit is not set up in this repository (no .specify/).')
  }
  if (!snap.claudeIntegration) {
    return step('integration', `${specifyCli(snap)} integration install claude`, "Spec Kit is set up, but not for Claude Code: its /speckit-* skills are missing.")
  }
  if (!snap.constitution || snap.constitution.principles.length === 0) {
    return step('constitution', speckitCommand(snap, 'constitution'), 'The constitution is missing or still the template.')
  }
  if (!snap.featureDir || !snap.spec) {
    return idea
      ? step('specify', `${speckitCommand(snap, 'specify')} ${idea}`, 'No feature yet; the person has said what to build.')
      : step('specify', speckitCommand(snap, 'specify'), 'No feature yet: describe what to build.', 'Describe the feature you want built; your own words become the spec.')
  }

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

export const idleAutopilot = (): Autopilot => ({ on: false, paused: null, steps: 0, max: 25, last: null, stalls: 0, lastPhase: null, idea: null })

/** What has to change between two autopilot steps for the run to count as moving. */
export function progressKey(snap: Snapshot, ledger: Ledger): string {
  const report = evaluate(snap, ledger)
  const mapped = Object.values(ledger.requirements).filter(r => r.tasks.length > 0).length
  return [
    snap.initialized,
    snap.claudeIntegration,
    snap.constitution?.principles.length ?? 0,
    snap.featureDir ?? '-',
    snap.spec?.reqs.length ?? 0,
    snap.spec?.reqs.filter(r => r.needsClarification).length ?? 0,
    snap.hasPlan,
    `${report.done}/${report.tasks}`,
    mapped,
    report.level,
    ledger.semantic?.at ?? '-',
  ].join('|')
}

/** The rules the autopilot gives the model with every step it hands over. */
export const AUTONOMY_RULES = [
  'Autopilot is on. Carry the step through without asking whether to continue: when you end your turn, the autopilot moves on by itself.',
  'Decide what the person left open, from the spec, the constitution and the repository, and record those choices as assumptions in the artifact you write.',
  'Stop only for what only the person can decide: the product idea, a [NEEDS CLARIFICATION] question, a conflict between their request and the spec, anything destructive or irreversible, credentials or payments. Then call mcp__speckit-xref__ask with the question, put the question in your answer, and end your turn.',
]

/** The prompt the autopilot submits for one step. */
export function autopilotPrompt(step: Step, n: number, max: number, context: string | null): string {
  const run =
    step.phase === 'setup'
      ? `Set Spec Kit up now, following the speckit-xref:speckit skill: run \`${step.command}\`. The person switched the autopilot on, which approves it.`
      : step.phase === 'integration'
        ? `Install Spec Kit's Claude Code integration now: run \`${step.command}\`.`
        : `Run ${step.command} now: invoke it through the Skill tool and carry it through.`
  return [
    `[speckit-xref autopilot · step ${n}/${max}] ${step.phase}: ${step.why}`,
    run,
    ...step.notes.map(note => `Note: ${note}`),
    '',
    ...AUTONOMY_RULES,
    ...(context ? ['', context] : []),
  ].join('\n')
}

/** Whether a model's answer ends on a question, the one case the autopilot asks a small model about. */
export const endsWithQuestion = (answer: string) => /\?["')\]*_\s]*$/.test(answer.trim().slice(-400))

/** The labels for that question; the first means stop. A "shall I continue?" is the second. */
export const QUESTION_LABELS = ['needs a decision only the person can make', 'asks only whether to continue, or reports progress'] as const
