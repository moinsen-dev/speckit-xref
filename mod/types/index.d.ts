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
  tools: { specify: boolean; uvx: boolean; maestro?: boolean; npx?: boolean; chrome?: boolean; deploy?: string[] }
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
  /** Whether Shape wrote `.specify/memory/product-brief.md`, and the decisions it records as the person's. */
  productBrief?: boolean
  briefDecisions?: string[]
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
  /** A PRD file at the root (`PRD_Show.md`), and whether it is imported to `.specify/memory/prd.md`. */
  prdSource?: string | null
  prd?: boolean
  /** The PRD's review and roadmap, their fingerprint, and whether the person approved the roadmap. */
  prdReview?: PrdReview | null
  roadmap?: RoadmapItem[]
  prdFingerprint?: string | null
  prdApproved?: boolean
  /** The PRD sections the active feature implements, for the intent check. */
  prdExcerpt?: string | null
  /** The platforms plan.md names, and what acceptance.md says: evidence per scenario and what only the person can check. */
  platforms?: { web: boolean; ios: boolean; android: boolean }
  /** Whether the project has Playwright's test runner (`@playwright/test` in package.json). */
  playwright?: boolean
  acceptanceDoc?: AcceptanceNote | null
  /** `.specify/memory/release.md`: the release check, its commands, the person's part and the releases so far (0.7.0). */
  release?: ReleaseNote | null
  /** `<feature>/polish.md`: the design pass's direction, what the person approves, and its review rounds (0.9.0). */
  polish?: PolishNote | null
}

/** `<feature>/polish.md` as the mod reads it. */
export type PolishNote = {
  /** The direction's first line: the feel in one sentence. */
  direction: string | null
  /** Of the file before its Rounds: what the person approves. */
  fingerprint: string
  /** The review rounds written so far. */
  rounds: number
}

/** `.specify/memory/release.md` as the mod reads it. */
export type ReleaseNote = {
  version: string | null
  targets: string[]
  /** Claude's word on the app (the person's part aside): null while the file says nothing. */
  ready: boolean | null
  readyNote: string | null
  checks: { area: string; check: string; result: 'pass' | 'fail' | 'your part' | 'n/a'; evidence: string }[]
  /** The commands that release it, in order: they run only after the person's yes. */
  commands: string[]
  yourPart: { text: string; done: boolean; when: 'before' | 'after' }[]
  releases: { date: string; version: string; target: string; ok: boolean; where: string }[]
  /** Of the file without its Releases log: what the person approves. */
  fingerprint: string
}

/** `<feature>/acceptance.md` as the mod reads it. */
export type AcceptanceNote = { evidence: Record<string, { shot: string | null; flow: string | null }>; yourPart: string[] }

/** A feature of the roadmap cut from a PRD, in build order. */
export type RoadmapItem = { title: string; phase: string | null; scope: string[]; sections: string[]; gate: string | null; spec: string }

/** What the PRD review recommends and which open decisions block the first feature. */
export type PrdReview = { recommendation: 'build' | 'sharpen' | null; blocking: string[] }

/** A phase of tasks.md: what it is for, how it is tested on its own, and when it is done. */
export type PhaseNote = { goal: string | null; test: string | null; checkpoint: string | null }

/** A runnable check of quickstart.md and the ids it names. */
export type QuickRow = { ids: string[]; text: string }

/** What comes after a done feature, in the person's words. */
export type NextWork = { kind: 'feature' | 'change' | 'bug' | 'ship' | 'polish'; text: string }

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
  /** The spec's assumptions the person kept at the review, by the fingerprint of their text (0.6.1). */
  assumed?: Record<string, 'keep'>
  /** Acceptance per scenario (USn-ASm): a driver's fresh JUnit report played it through as a person would (0.6.0). */
  acceptance: Record<string, { ok: boolean; fingerprint: string; at: string; file: string }>
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
  /** The verify steps handed over in this run; past two (three with acceptance), closing the feature is the person's call. */
  verifies?: number
  /** The acceptance reports as they were when the acceptance step was handed over: only newer ones count. */
  acceptBaseline?: Record<string, number> | null
  /** The rows of release.md's log when the release step was handed over: only rows it adds report on it. */
  releaseRows?: number | null
  /** The step handed to a subagent (0.8.0): its agent type, model and brief, and whether the agent was started. */
  delegation?: { agent: string; model: string; description: string; brief: string; spawned?: boolean } | null
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
  /** Who did the step's work (0.8.0): the subagent's model, or `main` for the session itself. */
  model?: string
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
      turn: { id: string; startedAt: number; dirty: string[]; auto: boolean; head?: string } | null
      /** Prompts waiting for the session to be idle: the autopilot's next step, or the person's own message. */
      queue: { auto: boolean; person: boolean }
      /** The pane's detail view on narrow widths. */
      details: boolean
      /** When the person last spoke: the "since you left" card counts from here. */
      seenAt: number
      /** The chip under each booked write in the transcript, by tool_use_id: `T006 · FR-004` or `▲ unplanned`. */
      chips: Record<string, string>
      /** What the person allowed: a rail's label and until when it holds; once (the ask tool), or for a release step and its approved commands. */
      permits: { label: string; until: number; many?: boolean; commands?: string[] }[]
    }
  }
}
