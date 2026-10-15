// Tests, CI/CD and git (0.11.0): what a project builds besides the app, and where its work lands. A proof of concept or
// an MVP needs a type check and a person trying the app, not a test suite or a pipeline the agents spend their time on;
// and a feature lands on the branch the person works on unless they ask for a branch or a pull request. Pure.

import type { Ledger, Snapshot } from '../types'

export type TestMode = 'off' | 'run' | 'lean'
export type GitMode = 'current' | 'branch' | 'pr'
export const TEST_MODES: TestMode[] = ['off', 'run', 'lean']
export const GIT_MODES: GitMode[] = ['current', 'branch', 'pr']

/** CI/CD pipelines: written only when the person switches option ci on. */
export const CI_PATH = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.circleci\/|bitbucket-pipelines\.ya?ml$|azure-pipelines\.ya?ml$|\.eas\/workflows\/|Jenkinsfile$|\.buildkite\/|\.travis\.ya?ml$|codemagic\.ya?ml$|fastlane\/)/
/** The same paths inside a shell command, after a space, a quote or a slash. */
const CI_IN_COMMAND = new RegExp(CI_PATH.source.replace('(^|\\/)', '(^|[\\s/\'"=])').replace(/\$/g, '(?![\\w.-])'))
const WRITES = /(>|\btee\b|\bcp\b|\bmv\b|\bmkdir\b|\btouch\b|\bln\b|\binstall\b|\b(?:sed|perl)\s+(?:-[a-zA-Z]*\s+)*-i\b)/

/** Whether a call writes a CI/CD pipeline: a file tool on one, or a shell command that names one and writes. */
export function touchesCi(tool: string, input: Record<string, unknown>, root = ''): boolean {
  const rel = (p: string) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p)
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return CI_PATH.test(rel(String(input.file_path ?? input.notebook_path ?? '')))
  if (tool !== 'Bash') return false
  const command = String(input.command ?? '')
  return CI_IN_COMMAND.test(command) && WRITES.test(command)
}

/** A git command that makes or changes branches: the run stays on the person's branch unless option git says otherwise. */
const BRANCHING = /\bgit\s+(?:-C\s+\S+\s+)?(switch\b|checkout\s+(?:-[bB]|--orphan)\b|branch\s+(?!-)[^\s;&|]+|worktree\s+add\b)/
export const branches = (tool: string, input: Record<string, unknown>) => tool === 'Bash' && BRANCHING.test(String(input.command ?? ''))

/** A feature's branch: its folder's name, as Spec Kit numbers it. */
export const branchName = (featureDir: string) => featureDir.slice(featureDir.lastIndexOf('/') + 1)

/** What the steps that plan or build are told about tests. */
export function testsNote(mode: TestMode | undefined): string | null {
  if (mode === 'off') return 'Write no test tasks and no tests: this project runs without a test suite (option tests: off). The type check and the user test are its checks.'
  if (mode === 'run') return 'Write no new tests or test tasks (option tests: run): the existing suite is the gate; keep it green.'
  return null
}

/** What the steps are told about CI/CD. */
export const ciNote = (on: boolean | undefined) => (on === false ? 'Plan and write no CI/CD pipeline (no workflow files): option ci is off, and writing one is refused.' : null)

/** What the autopilot's gate is called: the project's tests, or its type check where it runs without tests. */
export function gateWords(snap: Pick<Snapshot, 'gate'>): { what: string; fails: string; still: string; passes: string; label: string } {
  return snap.gate === 'check'
    ? { what: 'the type check', fails: 'The type check fails', still: 'The type check still fails', passes: 'the type check passes', label: 'Check' }
    : { what: 'the tests', fails: 'The tests fail', still: 'The tests still fail', passes: 'the tests pass', label: 'Tests' }
}

/** What the project shows of its language: enough to name its type check. */
export type Project = {
  packageJson: string | null
  typescript: boolean
  pubspec: string | null
  cargo: boolean
  goMod: boolean
  swiftPackage: boolean
  mypy: boolean
  /** The package manager's run command: `npm run`, `pnpm`, `yarn`, `bun run`. */
  run: string
}

/** The type check of the project's language, or null: a script of its own first, else the language's usual one. */
export function checkCommandFor(p: Project): string | null {
  if (p.packageJson) {
    let scripts: Record<string, unknown> = {}
    try {
      scripts = (JSON.parse(p.packageJson) as { scripts?: Record<string, unknown> }).scripts ?? {}
    } catch {
      scripts = {}
    }
    const own = ['typecheck', 'type-check', 'check-types', 'types', 'tsc'].find(s => typeof scripts[s] === 'string')
    if (own) return `${p.run} ${own}`
  }
  if (p.typescript) return 'npx --no-install tsc --noEmit'
  if (p.pubspec) return /^\s*flutter\s*:/m.test(p.pubspec) ? 'flutter analyze --no-fatal-infos' : 'dart analyze'
  if (p.cargo) return 'cargo check'
  if (p.goMod) return 'go vet ./...'
  if (p.swiftPackage) return 'swift build'
  if (p.mypy) return 'mypy .'
  return null
}

/** The pull request's text: what the feature is, what it covers, how it was checked. */
export function prBody(snap: Snapshot, ledger: Ledger): string {
  const spec = snap.spec
  const done = snap.tasks.filter(t => t.done).length
  const reqs = (spec?.reqs ?? []).filter(r => r.kind === 'FR' && r.status === 'active').slice(0, 20)
  const checked = [
    ledger.checkpoints.verify ? 'verified against the spec' : null,
    ledger.checkpoints.try ? 'tried as a person would (user test)' : null,
    snap.gate === 'check' ? 'type check green' : 'tests green',
  ].filter(Boolean)
  return [
    `## ${spec?.title ?? branchName(snap.featureDir ?? '')}`,
    '',
    spec?.input ? `> ${spec.input.replace(/\s+/g, ' ').slice(0, 600)}` : '',
    '',
    `Spec: \`${snap.featureDir}/spec.md\` · Tasks: ${done}/${snap.tasks.length} · ${checked.join(' · ')}`,
    '',
    ...(reqs.length ? ['### Requirements', ...reqs.map(r => `- **${r.id}** ${r.text.slice(0, 200)}`), ''] : []),
    'Built with GitHub Spec Kit and the speckit-xref autopilot. Merging is yours.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}
