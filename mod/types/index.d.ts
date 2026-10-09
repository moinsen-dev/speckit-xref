// The speckit-xref contract: what the mod reads out of Spec Kit, what it keeps per feature, and the session values it draws from.

export type Story = { id: string; title: string; priority: string | null }
export type Req = { id: string; kind: 'FR' | 'SC'; text: string; needsClarification: boolean }
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
  spec: Spec | null
  tasks: Task[]
  constitution: Constitution | null
  /** How the project invokes Spec Kit's commands: `/speckit-clarify` (skills) or `/speckit.clarify` (commands). */
  commandStyle: 'skills' | 'commands'
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
}

/** What the mod keeps per feature, persisted as `specs/<feature>/xref.json`. */
export type Ledger = {
  tasks: Record<string, { touched: string[]; linked: string[] }>
  requirements: Record<string, { tasks: string[]; files: string[]; sources: string[] }>
  unplanned: Unplanned[]
  intents: Intent[]
  anchors: Anchor[]
  semantic: Semantic | null
}

declare module 'claude-code' {
  interface PluginState {
    'speckit-xref': {
      snapshot: Snapshot | null
      ledger: Ledger
      active: string | null
      checking: boolean
    }
  }
}
