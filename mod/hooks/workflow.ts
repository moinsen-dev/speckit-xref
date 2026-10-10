// Where a project stands in Spec Kit's workflow, the step that comes next, and the autopilot's rules. Pure: register.tsx hands in the snapshot.

import type { Autopilot, IdeaBrief, Ledger, Snapshot, Task } from '../types'
import { fingerprint, specFingerprint } from './rules'
import { evaluate, speckitCommand } from './xref'

export type Phase =
  | 'setup'
  | 'integration'
  | 'validate'
  | 'shape'
  | 'constitution'
  | 'specify'
  | 'clarify'
  | 'review'
  | 'plan'
  | 'tasks'
  | 'revise'
  | 'map'
  | 'analyze'
  | 'remediate'
  | 'checklists'
  | 'implement'
  | 'repair'
  | 'converge'
  | 'verify'
export type Step = {
  phase: Phase
  command: string | null
  why: string
  notes: string[]
  /** Set when only the person can take this step: what they have to do. */
  needsUser: string | null
  /** What the step hands Claude instead of "run <command>", for steps that are no single command. */
  prompt?: string
  /**
   * What the step settles: an approval only the person gives (`spec`, `plan`, `checklists`), or a checkpoint the
   * autopilot records when it hands the step over (`analyze`, `converge`); the value is the fingerprint it holds for.
   */
  approve?: { key: string; value: string }
  /** The request a revise step folds into the spec: handing the step over takes it off the list. */
  resolves?: string
}

/** What the workflow reads beyond the snapshot: the review option, the persistence model, the last test run. */
export type Flow = {
  review: 'spec' | 'spec+plan' | 'none'
  /** Validate and Shape for a new project's first feature (both on unless switched off). */
  validate?: boolean
  shape?: boolean
  lastTest?: Autopilot['lastTest']
  repairs?: number
  /** The last analysis found something to fix: the next step applies its remediation. */
  remediate?: boolean
}

const INIT = 'init --here --force --non-interactive --integration claude'
export const MAX_REPAIRS = 3

/** How Spec Kit's CLI runs here: installed, or through uvx without installing. */
export const specifyCli = (snap: Snapshot) => (snap.tools.specify ? 'specify' : `uvx --from 'specify-cli>=1.1,<2' specify`)

/** What a spec change sets off (docs/research.de.md §5), as the constitution names it: `Persistence model: living`. */
export type Persistence = 'flow-back' | 'flow-forward' | 'living'
export function persistenceModel(constitutionMd: string | null): Persistence {
  const m = /persistence(?:\s+model)?\s*[:=-]\s*\**\s*(flow[- ]back|flow[- ]forward|living(?:\s+spec)?)/i.exec(constitutionMd ?? '')
  const value = m?.[1]?.toLowerCase().replace(' ', '-') ?? 'flow-back'
  return value.startsWith('living') ? 'living' : value === 'flow-forward' ? 'flow-forward' : 'flow-back'
}

/** What a backticked span must start with to be a command rather than a package or a tool name (`jest-expo`). */
const RUNNER = /^(?:npm|npx|pnpm|yarn|bun|bunx|deno|node|pytest|python3?|uv|poetry|cargo|go|flutter|dart|make|mvn|gradle|\.\/gradlew|dotnet|bundle|rake|rspec|mix|swift|xcodebuild|vitest|jest|phpunit|composer)(?=\s|$)/

/** The test command plan.md's `**Testing**:` line implies: a backticked command as written, else the framework's usual one. */
export function testCommandFrom(planMd: string | null): string | null {
  const line = /^\*\*Testing\*\*:\s*(.+)$/m.exec(planMd ?? '')?.[1]?.trim()
  if (!line || /NEEDS CLARIFICATION|^\[/.test(line)) return null
  const ticked = [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]!.trim()).find(t => RUNNER.test(t))
  if (ticked) return ticked
  const known: [RegExp, string][] = [
    [/vitest/i, 'npx vitest run'],
    [/jest/i, 'npx jest'],
    [/playwright/i, 'npx playwright test'],
    [/pytest/i, 'pytest'],
    [/cargo/i, 'cargo test'],
    [/\bgo test|\bgo\b/i, 'go test ./...'],
    [/flutter/i, 'flutter test'],
    [/dart/i, 'dart test'],
    [/rspec/i, 'bundle exec rspec'],
    [/npm test|node:test|mocha/i, 'npm test'],
  ]
  return known.find(([re]) => re.test(line))?.[1] ?? null
}

/**
 * The project's own test script, when package.json has one: what `npm test` runs is what the project means by
 * "the tests". A watch-mode script would never end, and npm's placeholder fails on purpose: neither counts.
 */
export function testScriptCommand(packageJson: string | null, lockfiles: { pnpm: boolean; yarn: boolean; bun: boolean }): string | null {
  let script: unknown
  try {
    script = (JSON.parse(packageJson ?? '') as { scripts?: Record<string, unknown> }).scripts?.test
  } catch {
    return null
  }
  if (typeof script !== 'string' || !script.trim() || /no test specified|--watch(?:All)?\b(?!=false)/.test(script)) return null
  return lockfiles.pnpm ? 'pnpm test' : lockfiles.yarn ? 'yarn test' : lockfiles.bun ? 'bun run test' : 'npm test'
}

/** The line of a test run that says what failed (`Test Suites: 1 failed, 27 passed`), not its last words (`Ran all test suites.`). */
export function failureLine(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
  return [...lines].reverse().find(l => /\b(fail(ed|ing|ures?)?|error|✕|FAIL)\b/i.test(l)) ?? lines.at(-1) ?? ''
}

/** Whether a test run failed to start rather than failed: the shell's "command not found" and "not executable". */
export const couldNotRun = (exitCode: number, output: string) => exitCode === 126 || exitCode === 127 || /command not found|not recognized as an internal or external command/i.test(output.slice(-2000))

/** Where the spec stands with the person: approved for this text, approved for an older one, or never reviewed. */
export function specReview(snap: Snapshot, ledger: Ledger): 'approved' | 'changed' | 'unreviewed' {
  if (!snap.spec) return 'unreviewed'
  if (!ledger.approvals.spec) return 'unreviewed'
  return ledger.approvals.spec === specFingerprint(snap.spec) ? 'approved' : 'changed'
}

/** tasks.md's `##` phases in order, each with its tasks done and in all, and which one is open now. */
export type TaskPhase = { title: string; done: number; total: number }
export function taskPhases(tasks: Task[]): { phases: TaskPhase[]; current: number } {
  const phases: TaskPhase[] = []
  for (const t of tasks) {
    const title = t.phase || 'Tasks'
    let p = phases.find(x => x.title === title)
    if (!p) phases.push((p = { title, done: 0, total: 0 }))
    p.total += 1
    if (t.done) p.done += 1
  }
  return { phases, current: phases.findIndex(p => p.done < p.total) }
}

/** A phase's number as tasks.md writes it (`Phase 3: …` is 3, even with no Phase 2), else its place in the file. */
export const phaseNumber = (title: string, index: number) => Number(/^Phase\s+(\d+)/i.exec(title)?.[1] ?? index + 1)

/** `Phase 3: User Story 1 – Inspiration für den Moment (Priority: P1) 🎯 MVP` → `US1 Inspiration für den Moment (P1) MVP`. */
export function phaseLabel(title: string): string {
  return title
    .replace(/^Phase\s+\d+\s*[:.–-]\s*/i, '')
    .replace(/User Story\s+(\d+)\s*[–—:-]\s*/i, 'US$1 ')
    .replace(/\(Priority:\s*(P\d+)\)/i, '($1)')
    .replace(/🎯\s*/g, '')
    .trim()
}

/** The first `##` phase of tasks.md that still has an open task: what one implement step covers. */
export const openPhase = (tasks: Task[]) => tasks.find(t => !t.done)?.phase || null

/** A fingerprint of the task list that ignores the checkboxes: converge changes it, implement does not. */
export const tasksFingerprint = (tasks: Task[]) => fingerprint(tasks.map(t => `${t.id} ${t.text}`).join('\n'))

/** The open checklist items of a feature's `checklists/*.md`, by file. */
export function openChecklistItems(files: Record<string, string>): { file: string; open: number }[] {
  return Object.entries(files)
    .map(([file, text]) => ({ file, open: (text.match(/^\s*[-*]\s*\[ \]/gm) ?? []).length }))
    .filter(f => f.open > 0)
}

export function nextStep(snap: Snapshot, ledger: Ledger, idea: string | null = null, flow: Flow = { review: 'spec' }): Step {
  const notes: string[] = []
  const xref = snap.extensions.includes('xref')
  const has = (name: string) => (snap.commands ?? []).includes(name)
  const step = (phase: Phase, command: string | null, why: string, needsUser: string | null = null, extra: Partial<Step> = {}): Step => ({ phase, command, why, notes, needsUser, ...extra })

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
  // A new project's first feature starts at the idea: researched (Validate) and shaped with the person (Shape)
  // before the constitution and the spec are written from it.
  const greenfield = snap.folder === 'empty' && snap.features.length === 0 && (!snap.featureDir || !snap.spec)
  if (greenfield && flow.validate !== false) {
    const brief = snap.ideaBrief
    const decided = brief && snap.ideaDecision?.fingerprint === brief.fingerprint ? snap.ideaDecision.decision : null
    if (!brief && !idea) {
      return step('validate', null, 'No idea yet: it is researched before it becomes a spec.', 'Describe what you want to build, in your own words: I research it first, then we shape and specify it.')
    }
    if (!brief) {
      return step('validate', null, 'The idea is known: research it before it becomes a spec.', null, { prompt: validatePrompt(idea!) })
    }
    if (decided === 'drop') return step('validate', null, `You dropped the idea "${brief.title}".`, 'You dropped this idea: Reopen it in the pane, or start a new idea there.')
    if (decided !== 'build') {
      return step('review', null, `The idea brief is written: ${brief.oneLiner ?? brief.title}${brief.score !== null ? ` (score ${brief.score}/5, ${brief.recommendation ?? 'no recommendation'})` : ''}.`,
        'Read the idea brief, then press Build, Sharpen or Drop in the pane.', { approve: { key: 'idea', value: brief.fingerprint } })
    }
  }
  if (greenfield && flow.shape !== false && !snap.productBrief) {
    return step('shape', null, 'Before the spec: settle with the person what the first version is (scope, platforms, language, design, data).', null, { prompt: SHAPE_PROMPT })
  }
  if (!snap.constitution || snap.constitution.principles.length === 0) {
    if (snap.ideaBrief || snap.productBrief) notes.push(BRIEFS_NOTE)
    return step('constitution', speckitCommand(snap, 'constitution'), 'The constitution is missing or still the template.')
  }
  if ((!snap.featureDir || !snap.spec) && snap.commits === false) {
    // Spec Kit opens a branch per feature only in a repository with a commit to branch from.
    return step('setup', null, 'The repository has no commit yet: Spec Kit opens a branch per feature only from one.', 'Make the first commit: press First commit in the pane, or ask for it.')
  }
  if (!snap.featureDir || !snap.spec) {
    if (snap.ideaBrief || snap.productBrief) notes.push(BRIEFS_NOTE)
    return idea
      ? step('specify', `${speckitCommand(snap, 'specify')} ${idea}`, 'No feature yet; the person has said what to build.')
      : step('specify', speckitCommand(snap, 'specify'), 'No feature yet: describe what to build.', 'Describe the feature you want built; your own words become the spec.')
  }

  const spec = snap.spec
  if (snap.commits === false) notes.push('No commit yet: Spec Kit cannot branch per feature, and commit per task and the GitHub Action need commits (First commit in the pane).')
  const unclear = spec.reqs.filter(r => r.needsClarification).map(r => r.id)
  const specFp = specFingerprint(spec)
  // The one review: where the idea becomes the contract. A project planned before 0.4 counts as reviewed until its spec changes.
  const specApproved = ledger.approvals.spec ? ledger.approvals.spec === specFp : snap.hasPlan
  if (!snap.hasPlan && unclear.length) return step('clarify', speckitCommand(snap, 'clarify'), `${unclear.join(', ')} still marked NEEDS CLARIFICATION; settle them before planning.`)
  if (flow.review !== 'none' && !specApproved) {
    return step('review', null, `The spec of ${snap.featureDir} is written: ${spec.reqs.filter(r => r.kind === 'FR').length} requirements, ${spec.outOfScope.length} out of scope, ${spec.assumptions.length} assumptions.`,
      'Review the spec against your words, then press Approve spec in the pane (or /xref approve); tell me what to change otherwise.', { approve: { key: 'spec', value: specFp } })
  }
  if (!snap.hasPlan) return step('plan', speckitCommand(snap, 'plan'), 'The spec is written; plan.md is missing.')
  if (flow.review === 'spec+plan' && snap.planFingerprint) {
    const planApproved = ledger.approvals.plan ? ledger.approvals.plan === snap.planFingerprint : snap.tasks.length > 0
    if (!planApproved) {
      return step('review', null, `The plan of ${snap.featureDir} is written.`, 'Review plan.md, then press Approve plan in the pane (or /xref approve); tell me what to change otherwise.', { approve: { key: 'plan', value: snap.planFingerprint } })
    }
  }
  if (unclear.length) notes.push(`${unclear.join(', ')} still marked NEEDS CLARIFICATION (${speckitCommand(snap, 'clarify')}).`)
  if (snap.tasks.length === 0) return step('tasks', speckitCommand(snap, 'tasks'), 'The plan is written; tasks.md is missing.')

  // A request beyond the spec reaches the spec before more code does; a contradiction is always the person's.
  const changes = ledger.semantic?.changes ?? []
  const contradiction = changes.find(c => c.kind === 'contradicts')
  if (contradiction) return step('revise', null, `"${contradiction.text}" contradicts the spec.`, `Your request "${contradiction.text}" contradicts the spec: keep the spec, or change it (To spec in the pane).`)
  const extension = changes.find(c => c.kind === 'extends')
  if (extension) {
    if (snap.persistence === 'flow-forward') return step('revise', null, `"${extension.text}" goes beyond the spec.`, `You asked for "${extension.text}", which the spec does not cover: fold it into the spec (To spec), or make it a task (As task).`)
    const revise = xref && has('xref-revise') ? speckitCommand(snap, 'xref.revise') : speckitCommand(snap, 'clarify')
    return step('revise', `${revise} The user asked during implementation: "${extension.text}". Fold it into the spec, new requirements under new ids.`, `"${extension.text}" goes beyond the spec; the spec follows the request (${snap.persistence ?? 'flow-back'}).`, null, { resolves: extension.text })
  }

  const report = evaluate(snap, ledger)
  if (report.level === 'red' || report.level === 'yellow') notes.push(`Drift ${report.level}: ${report.findings[0]?.text ?? ''}`)
  const mapped = Object.values(ledger.requirements).some(r => r.tasks.length > 0)
  const uncovered = report.uncovered.filter(id => !unclear.includes(id))
  if (uncovered.length && !mapped) {
    return step('map', xref ? speckitCommand(snap, 'xref.map') : '/xref map', `${uncovered.join(', ')} name no task yet; map requirements to tasks once.`)
  }
  const open = snap.tasks.filter(t => !t.done)
  const started = snap.tasks.some(t => t.done)
  // analyze before the first implement, and again after every change to the spec.
  if (open.length && has('analyze') && (ledger.checkpoints.analyze ? ledger.checkpoints.analyze !== specFp : !started)) {
    return step('analyze', speckitCommand(snap, 'analyze'), started ? 'The spec changed since the last analysis: check spec, plan and tasks against each other.' : 'Before the first task: check spec, plan and tasks against each other.', null, { approve: { key: 'analyze', value: specFp } })
  }
  // An analysis that found something is followed through: its fixes go in before the next task does.
  if (open.length && (flow.remediate || ledger.checkpoints.remediate === 'due')) {
    return step('remediate', null, 'The analysis found inconsistencies: apply its remediation before the next task.', null, {
      prompt: [
        `Apply the remediation the last ${speckitCommand(snap, 'analyze')} proposed, in this step and without asking whether to.`,
        'Edit tasks.md, plan.md, data-model.md and spec.md where the findings point. Keep every existing id; new tasks get the next free T### in the phase they belong to, new requirements the next free FR-###. Check nothing off.',
        'Decide what the person left open and record it as an assumption. A product decision only the person can make (scope, a user-facing behaviour the spec leaves open) goes to mcp__speckit-xref__ask, with options and the stories it blocks.',
      ].join('\n'),
    })
  }
  if (flow.lastTest && !flow.lastTest.ok) {
    if ((flow.repairs ?? 0) > MAX_REPAIRS) {
      return step('repair', null, `The tests still fail after ${MAX_REPAIRS} repairs.`, `The tests still fail after ${MAX_REPAIRS} attempts: look at the failure in the pane and decide how to go on.`)
    }
    return step('repair', snap.testCommand, `The tests fail (repair ${Math.max(1, flow.repairs ?? 0)} of ${MAX_REPAIRS}).`, null, {
      prompt: `The tests fail. Run \`${snap.testCommand}\`, find the cause and fix the code (not the tests, unless a test contradicts the spec). Do not check off new tasks in this step.\nLast output:\n${flow.lastTest.output.slice(-1500)}`,
    })
  }
  if (open.length) {
    const checklists = snap.checklists ?? []
    const listFp = fingerprint(checklists.map(c => `${c.file}:${c.open}`).join('\n'))
    if (checklists.length && !started && ledger.approvals.checklists !== listFp) {
      return step('checklists', null, `${checklists.reduce((n, c) => n + c.open, 0)} checklist items are open (${checklists.map(c => c.file).join(', ')}).`, 'Checklist items are open: complete them, or press Proceed anyway in the pane (/xref approve).', { approve: { key: 'checklists', value: listFp } })
    }
    // One phase per step (Spec Kit's own advice for larger features): the budget and the stall check then measure real work.
    const phase = snap.phase
    const command = speckitCommand(snap, 'implement')
    const ids = (phase ? open.filter(t => t.phase === phase) : open).map(t => t.id)
    return step('implement', command, `${open.length} of ${snap.tasks.length} tasks open; next ${open[0]!.id}.`, null, {
      prompt: phase
        ? `Run ${command} now through the Skill tool, scoped by its argument to one phase: "Only the phase '${phase}' (${ids.join(', ')}); stop when it is done." Carry that phase through.`
        : undefined,
    })
  }
  const tasksFp = snap.tasksFingerprint || tasksFingerprint(snap.tasks)
  if (has('converge') && ledger.checkpoints.converge !== tasksFp) {
    return step('converge', speckitCommand(snap, 'converge'), 'Every task is checked: find the work the tasks missed.', null, { approve: { key: 'converge', value: tasksFp } })
  }
  if (xref) return step('verify', speckitCommand(snap, 'xref.check'), 'Every task is checked: check the code against the spec.')
  // Without the extension there is no command the model can run: it checks by itself, and the mod's intent check follows.
  return step('verify', null, 'Every task is checked: check the code against the spec.', null, {
    prompt: [
      "Check the code against the spec and against the person's own words (the spec's Input), by yourself: /xref check is the person's command, not one you can run.",
      'For each requirement name the code and the test that prove it. For each point the person made, say whether the app does it.',
      "Whatever is missing or differs becomes a new task at the end of tasks.md under '## Phase N: Verification' (the next free T### ids). Then end your turn.",
    ].join('\n'),
  })
}

/** What Validate is handed: the person's words and the skill that researches them. */
export function validatePrompt(idea: string): string {
  return [
    'Validate the idea before it becomes a spec, with the speckit-xref:validate skill: research it (the speckit-xref:idea-researcher agent does the web research where web tools are there) and write .specify/memory/idea-brief.md in the format the skill gives.',
    `The idea, in the person's words: "${idea}"`,
    'Never invent a source: an alternative without a URL you fetched is marked (unverified). Without web tools, say so in the brief. Do not write a **Decision** line: Build, Sharpen or Drop is the person\'s call.',
  ].join('\n')
}

const SHAPE_PROMPT = [
  'Shape the first version with the person before the spec is written, with the speckit-xref:shape skill.',
  'Ask in the AskUserQuestion dialog only what the idea and .specify/memory/idea-brief.md leave open: which user stories make the first version (the MVP cut), platforms, language and internationalisation, the design direction (mood, references, dark mode, accessibility), data and accounts. At most 4 questions a round, the recommended answer first.',
  "Write .specify/memory/product-brief.md with '## Decisions (the person's)' and '## Assumptions (Claude's)'. Where nobody can answer (no dialog), record each point as an assumption.",
].join('\n')

const BRIEFS_NOTE =
  "Use .specify/memory/idea-brief.md and .specify/memory/product-brief.md: the decisions in them are the person's (write them as decided, never as assumptions), the brief's success measures become SC-###, its riskiest assumption is what the first user story tests, and its differentiation belongs in the constitution."

/** Reads an idea brief (`.specify/memory/idea-brief.md`, the format the validate skill writes). */
export function parseIdeaBrief(markdown: string): IdeaBrief {
  const field = (name: string) => new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi').exec(markdown)?.[1]?.trim() ?? null
  const section = (name: RegExp) => {
    const out: string[] = []
    let inside = false
    for (const line of markdown.split('\n')) {
      const h = /^##\s+(.+)$/.exec(line)
      if (h) {
        inside = name.test(h[1] ?? '')
        continue
      }
      const item = inside ? /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line) : null
      if (item) out.push(item[1]!.trim())
    }
    return out
  }
  const rec = field('Recommendation')?.toLowerCase().match(/build|sharpen|drop/)?.[0] as IdeaBrief['recommendation'] | undefined
  const score = Number(/([\d.]+)\s*\/\s*5/.exec(field('Score') ?? '')?.[1])
  const research = field('Research')
  return {
    title: /^#\s+(?:Idea Brief:\s*)?(.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Idea',
    oneLiner: field('One-liner'),
    recommendation: rec ?? null,
    score: Number.isFinite(score) ? score : null,
    research: !!research && !/^none\b/i.test(research),
    alternatives: section(/^alternatives/i).map(line => {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*[:–—-]?\s*(.*)$/.exec(line)
      if (link && !/\(unverified\)/i.test(line)) return { name: link[1]!, url: link[2]!, note: link[3] ?? '', verified: true }
      const [name, ...rest] = line.replace(/\[([^\]]+)\]\([^)]*\)/, '$1').split(/:\s+/)
      return { name: name!.replace(/\s*\(unverified\)\s*/i, '').trim(), url: null, note: rest.join(': '), verified: false }
    }),
    risks: section(/riskiest/i),
    kill: section(/^kill/i),
    success: section(/^success/i),
    fingerprint: fingerprint(markdown.split('\n').filter(l => !/^\*\*Decision\*\*:/i.test(l)).join('\n')),
  }
}

/** The step as one line, as the pane, /xref and the note on each prompt show it. */
export const stepLine = (s: Step) => (s.command ? `${s.command} · ${s.why}` : s.why)

export const idleAutopilot = (): Autopilot => ({
  on: false,
  paused: null,
  steps: 0,
  max: 25,
  last: null,
  stalls: 0,
  lastPhase: null,
  idea: null,
  repairs: 0,
  lastTest: null,
  startedAt: null,
  costAtStart: 0,
  night: false,
  scope: null,
  remediate: false,
  remediations: 0,
  testNote: null,
})

/** Whether the person's next words are the idea to specify: the autopilot waits on them for exactly that. */
export const takesIdea = (step: Step, snap: Snapshot) =>
  step.phase === 'specify' || (step.phase === 'validate' && step.needsUser !== null && !snap.ideaBrief) || (step.phase === 'setup' && snap.folder === 'empty' && step.command !== null)

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
    snap.tasksFingerprint ?? '-',
    mapped,
    report.level,
    Object.values(report.levels).join('/'),
    ledger.semantic?.at ?? '-',
    JSON.stringify(ledger.checkpoints),
  ].join('|')
}

/** The rules the autopilot gives the model with every step it hands over. */
export const AUTONOMY_RULES = [
  'Autopilot is on. Carry the step through without asking whether to continue: when you end your turn, the autopilot moves on by itself.',
  'Decide what the person left open, from the spec, the constitution and the repository, and record those choices as assumptions in the artifact you write.',
  'Stop only for what only the person can decide: the product idea, a [NEEDS CLARIFICATION] question, a conflict between their request and the spec, anything destructive or irreversible, credentials or payments. Then call mcp__speckit-xref__ask with the question (and the user stories it blocks, if any); if it answers with the person\'s choice, go on with it, otherwise put the question in your answer and end your turn.',
]

/** The prompt the autopilot submits for one step. */
export function autopilotPrompt(step: Step, n: number, max: number, context: string | null): string {
  return [
    `[speckit-xref autopilot · step ${n}/${max}] ${step.phase}: ${step.why}`,
    step.prompt ?? `Run ${step.command} now: invoke it through the Skill tool and carry it through.`,
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

/** The phase strip: `✓setup ✓const ✓spec ✓plan ✓tasks ▶impl 7/8 ·verify`; `◌spec` is a spec passed without your review. */
export function phaseStrip(snap: Snapshot, step: Step, unreviewed = false): string {
  // The idea column shows only for a project that started at an idea (Validate, Shape).
  const ideas = !!snap.ideaBrief || !!snap.productBrief || step.phase === 'validate' || step.phase === 'shape'
  const order: [string, Phase[]][] = [
    ['setup', ['setup', 'integration']],
    ...(ideas ? [['idea', ['validate', 'shape']] as [string, Phase[]]] : []),
    ['const', ['constitution']],
    ['spec', ['specify', 'clarify', 'review', 'revise']],
    ['plan', ['plan']],
    ['tasks', ['tasks', 'map', 'analyze', 'remediate', 'checklists']],
    ['impl', ['implement', 'repair', 'converge']],
    ['verify', ['verify']],
  ]
  const at = order.findIndex(([, phases]) => phases.includes(step.phase))
  const done = snap.tasks.filter(t => t.done).length
  return order
    .map(([label], i) => {
      const extra = label === 'impl' && snap.tasks.length ? ` ${done}/${snap.tasks.length}` : ''
      return i < at ? `${label === 'spec' && unreviewed ? '◌' : '✓'}${label}` : i === at ? `▶${label}${extra}` : `·${label}`
    })
    .join(' ')
}
