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

  // Setting Spec Kit up writes into the repository: that is always the person's call, never the autopilot's.
  if (!snap.initialized) {
    if (!snap.tools.specify && !snap.tools.uvx) {
      return step('setup', null, 'Spec Kit is not set up, and neither the specify CLI nor uvx is on this machine.', 'Install uv (https://docs.astral.sh/uv/) or the specify CLI (pipx install specify-cli).')
    }
    return snap.folder === 'empty'
      ? step('setup', `${specifyCli(snap)} ${INIT}`, 'This folder is empty: a new app, project or problem can start here with Spec Kit.', 'Tell me what you want to build (an app, a project, a problem): I set Spec Kit up for it and write the spec in your words.')
      : step('setup', `${specifyCli(snap)} ${INIT}`, 'This folder has code, but no Spec Kit yet (no .specify/).', 'Say "set up Spec Kit here" to bring this project under Spec Kit, or press Set up Spec Kit in the pane.')
  }
  if (!snap.claudeIntegration) {
    return step('integration', `${specifyCli(snap)} integration install claude`, "Spec Kit is set up, but not for Claude Code: its /speckit-* skills are missing.", 'Say "add the Claude integration", or press Add Claude integration in the pane.')
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

/** Whether the person's next words are the idea to specify: the autopilot waits on them for exactly that. */
export const takesIdea = (step: Step, snap: Snapshot) => step.phase === 'specify' || (step.phase === 'setup' && snap.folder === 'empty' && step.command !== null)

/** What the model reads beside the person's prompt while the autopilot waits before Spec Kit is there. */
export function setupNote(step: Step, snap: Snapshot): string {
  const lines = [`speckit-xref · autopilot waiting · ${step.why}`]
  if (step.phase === 'setup' && step.command && snap.folder === 'empty') {
    lines.push(`If this message says what to build, set Spec Kit up now with the speckit-xref:speckit skill (\`${step.command}\`); the autopilot then goes on with the constitution and the spec in the person's words.`)
  } else if (step.phase === 'setup' && step.command) {
    lines.push(`Set Spec Kit up (speckit-xref:speckit skill, \`${step.command}\`) only if this message asks for it; otherwise leave the repository as it is.`)
  } else if (step.phase === 'integration') {
    lines.push(`Run \`${step.command}\` only if this message asks for it.`)
  }
  return lines.join('\n')
}

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
  return [
    `[speckit-xref autopilot · step ${n}/${max}] ${step.phase}: ${step.why}`,
    `Run ${step.command} now: invoke it through the Skill tool and carry it through.`,
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
