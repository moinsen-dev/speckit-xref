// The speckit-xref contract: what the mod reads out of Spec Kit, what it keeps per feature, and the session values it draws from.

export type Scenario = { id: string; text: string }
export type Story = { id: string; title: string; priority: string | null; scenarios: Scenario[] }
export type Req = {
  id: string
  kind: 'FR' | 'SC'
  text: string
  needsClarification: boolean
  /** Retired and superseded requirements stay in spec.md for history; they leave the ladder. */
  status: 'active' | 'superseded' | 'retired'
  supersededBy: string | null
}
export type Task = {
  id: string
  done: boolean
  parallel: boolean
  story: string | null
  text: string
  paths: string[]
  reqs: string[]
  phase: string
}
export type Spec = {
  title: string
  input: string | null
  stories: Story[]
  reqs: Req[]
  outOfScope: string[]
  assumptions: string[]
}
export type Constitution = { principles: string[]; musts: string[] }

export type Snapshot = {
  /** Whether Spec Kit is set up here (`.specify/` exists). */
  initialized: boolean
  featureDir: string | null
  /** Every feature directory under specs/ (and .specify/specs/). */
  features: string[]
  hasPlan: boolean
  /** Installed Spec Kit extensions, by id (`.specify/extensions/<id>/`). */
  extensions: string[]
  /** Whether Spec Kit's Claude Code integration is installed (its skills or commands are there). */
  claudeIntegration: boolean
  /** The Spec Kit release the project was set up with (`.specify/init-options.json`). */
  speckitVersion: string | null
  /** What can run Spec Kit's CLI on this machine. */
  tools: { specify: boolean; uvx: boolean }
  /** The project folder at a glance: nothing but dotfiles and a README (empty), or code already there (existing). */
  folder: 'empty' | 'existing'
  spec: Spec | null
  tasks: Task[]
  constitution: Constitution | null
  /** How the project invokes Spec Kit's commands: `/speckit-clarify` (skills) or `/speckit.clarify` (commands). */
  commandStyle: 'skills' | 'commands'
  /** What never counts as drift (exempt) and what is listed but not drift (unclear): defaults plus `.xrefignore`. */
  rules: { exempt: string[]; unclear: string[] }
  /** Test files tied to the feature whose content holds real tests (not only test.todo). */
  realTests: string[]
  /** The fingerprint of plan.md, for the spec+plan review gate. */
  planFingerprint: string | null
  /** The command that runs the project's tests: the plugin option, else plan.md's `**Testing**:` line. */
  testCommand: string | null
  /** The git branch checked out, when there is one. */
  branch: string | null
  /** The open `##` phase of tasks.md the autopilot implements next, if any. */
  phase: string | null
  /** A fingerprint of tasks.md's task lines, to see whether converge changed them. */
  tasksFingerprint: string
  /** The Spec Kit commands installed for Claude Code, without prefix: `plan`, `analyze`, `xref-check`. */
  commands: string[]
  /** Checklists of the feature with open items. */
  checklists: { file: string; open: number }[]
  /** What a spec change sets off, from the constitution (flow-back by default). */
  persistence: 'flow-back' | 'flow-forward' | 'living'
  /** Whether the git repository has a commit; null outside git. */
  commits?: boolean | null
  /** The idea brief Validate wrote (`.specify/memory/idea-brief.md`), and the person's decision on it. */
  ideaBrief?: IdeaBrief | null
  ideaDecision?: { decision: 'build' | 'drop'; fingerprint: string; at: string } | null
  /** Whether Shape wrote `.specify/memory/product-brief.md`. */
  productBrief?: boolean
  /** Whether the feature has a user interface, from plan.md's Project Type (else its Target Platform). */
  ui?: boolean
  /** The feature's design: DESIGN.md at the root and the screens of `<feature>/design/screens.md`. */
  design?: Design | null
  /** tasks.md's Goal, Independent Test and Checkpoint per `##` phase. */
  phaseNotes?: Record<string, PhaseNote>
  /** quickstart.md's table rows that name a story, scenario or requirement. */
  quickstart?: QuickRow[]
  /** `.specify/memory/runbook.md`: what earlier steps learned about the project's environment. */
  runbook?: string | null
  /** A fingerprint of the working tree's content (committed or not), for the verification that marks a feature done. */
  tree?: string | null
}

/** A phase of tasks.md: what it is for, how it is tested on its own, and when it is done. */
export type PhaseNote = { goal: string | null; test: string | null; checkpoint: string | null }

/** A runnable check of quickstart.md and the ids it names. */
export type QuickRow = { ids: string[]; text: string }

/** What comes after a done feature, in the person's words. */
export type NextWork = { kind: 'feature' | 'change' | 'bug'; text: string }

/** A screen of a feature, as `<feature>/design/screens.md` lists it. */
export type Screen = {
  name: string
  /** The user stories, scenarios and requirements it serves (`US1`, `US1-AS2`, `FR-003`). */
  serves: string[]
  /** Its mock, relative to the design folder (`moment.html`). */
  mock: string | null
  notes: string
}

/** What the design step wrote for a feature. */
export type Design = {
  /** Whether DESIGN.md (the design system) is at the project root. */
  system: boolean
  /** The screens the feature adds or changes; null while screens.md is missing, empty for "No screen changes". */
  screens: Screen[] | null
  /** What the step did to DESIGN.md, as screens.md's `**Design system**:` line says. */
  change: 'created' | 'extended' | 'unchanged' | null
  /** What git shows for DESIGN.md since the last commit, where the mod could look: the check on that claim. */
  verified?: 'created' | 'extended' | 'unchanged' | null
  /** DESIGN.md and screens.md together: what the person approves at the design review. */
  fingerprint: string
}

/** What Validate found out about an idea before it became a spec. */
export type IdeaBrief = {
  title: string
  oneLiner: string | null
  recommendation: 'build' | 'sharpen' | 'drop' | null
  score: number | null
  /** Whether the brief rests on web research, or says it had none. */
  research: boolean
  alternatives: { name: string; url: string | null; note: string; verified: boolean }[]
  risks: string[]
  kill: string[]
  success: string[]
  /** Of the brief's text without a Decision line: the person's decision holds for this text only. */
  fingerprint: string
}

export type Unplanned = { file: string; at: string; task: string | null; acknowledged: boolean }
export type IntentStatus = 'logged' | 'extends' | 'contradicts' | 'resolved'
export type Intent = { at: string; text: string; task: string | null; status: IntentStatus }
export type Anchor = { id: string; file: string; line: number }
export type Semantic = {
  score: number
  verdict: 'aligned' | 'minor' | 'drift'
  reasons: string[]
  changes: { text: string; kind: 'extends' | 'contradicts' }[]
  at: string
  /** git HEAD and a hash of the diff the verdict looked at. */
  head?: string
  diffHash?: string
}
export type Verification = { status: 'passing' | 'failing'; tests: string[]; at: string; commit: string; fingerprint: string }
export type Decision = {
  id: string
  question: string
  options: string[]
  blocks: string[]
  at: string
  answer: string | null
  /** A yes or no to an action the rails stopped (a push, a wipe): no product decision, never a request. */
  kind?: 'permission'
}

/**
 * What the mod keeps per feature. Persisted in two files (docs/contract-0.4.md §1): the committed
 * `specs/<feature>/xref.json` (map, links, accepted, fingerprints) and the local `.specify/xref/local/<feature>.json`.
 */
export type Ledger = {
  tasks: Record<string, { touched: string[]; linked: string[] }>
  /** By requirement id (FR, SC) and by scenario id (USn-ASm). */
  requirements: Record<string, { tasks: string[]; files: string[]; sources: string[] }>
  unplanned: Unplanned[]
  intents: Intent[]
  anchors: Anchor[]
  semantic: Semantic | null
  semanticHistory: Semantic[]
  /** A requirement's text fingerprint when it was last mapped, linked or verified. */
  fingerprints: Record<string, string>
  verification: Record<string, Verification>
  /** `spec`/`plan`: the fingerprint the person approved. */
  approvals: Record<string, string>
  decisions: Decision[]
  /** Workflow checkpoints: `analyze` (spec fingerprint analyzed), `converge` (tasks fingerprint converged). */
  checkpoints: Record<string, string>
  /** 2 since 0.5.0: requirement texts include their wrapped lines. An older ledger is re-baselined on load. */
  fingerprintVersion: number
  /** Keys of either file the mod does not know, written back as they were. */
  extra: { committed: Record<string, unknown>; local: Record<string, unknown> }
}

/** The autopilot: it moves through Spec Kit's workflow on its own and stops only for the person. */
export type Autopilot = {
  on: boolean
  /** Why it waits for the person; null while it runs. */
  paused: string | null
  steps: number
  max: number
  /** The progress key after the last step, the steps since it last changed, and the last phase. */
  last: string | null
  stalls: number
  lastPhase: string | null
  /** What the person asked for before a feature existed: the words /speckit-specify gets. */
  idea: string | null
  /** Failed test runs in a row; the fourth makes it the person's decision. */
  repairs: number
  /** The last test run: whether it passed and the tail of its output. */
  lastTest: { ok: boolean; at: string; output: string } | null
  /** When this run started, and the session's cost then, for the band's `$1.80 · 23m`. */
  startedAt: number | null
  costAtStart: number
  /** A night run: a larger budget, a briefing when it stops. */
  night: boolean
  /** The phase the last implement step was scoped to. */
  scope: string | null
  /** The tasks checked when the last step was handed over: commit per task commits what came after. */
  doneAtStep?: string[]
  /** The last analysis asked to fix something: the next step is its remediation (at most twice a run). */
  remediate?: boolean
  remediations?: number
  /** Why the test command could not run (not found, not executable): no failure, no repair step. */
  testNote?: string | null
  /** After a done feature: what the person said comes next, and the kind they chose before saying it. */
  next?: NextWork | null
  nextKind?: NextWork['kind'] | null
}

/** One autopilot step in the run log (`.specify/xref/local/<feature>.run.jsonl`). */
export type RunEntry = {
  at: string
  step: number
  phase: string
  task: string | null
  files: string[]
  durationMs: number
  tokens: number
  outcome: string
}

declare module 'claude-code' {
  interface PluginState {
    'speckit-xref': {
      snapshot: Snapshot | null
      ledger: Ledger
      active: string | null
      checking: boolean
      autopilot: Autopilot
      /** The question raised through the ask tool during the running turn. */
      asked: string | null
      /** The files written during the running turn, by tools or found changed at its end. */
      turnFiles: string[]
      /** The running turn's id and start, whether the autopilot handed it over, and the files dirty before it. */
      turn: { id: string; startedAt: number; dirty: string[]; auto: boolean } | null
      /** Prompts waiting for the session to be idle: the autopilot's next step, or the person's own message. */
      queue: { auto: boolean; person: boolean }
      /** The pane's detail view on narrow widths. */
      details: boolean
      /** When the person last spoke: the "since you left" card counts from here. */
      seenAt: number
      /** The chip under each booked write in the transcript, by tool_use_id: `T006 · FR-004` or `▲ unplanned`. */
      chips: Record<string, string>
      /** What the person allowed once through the ask tool: a rail's label and until when it holds. */
      permits: { label: string; until: number }[]
    }
  }
}
