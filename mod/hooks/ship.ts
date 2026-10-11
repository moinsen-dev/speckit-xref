// Ship (0.7.0): after a done feature the person can release the app. A release check writes .specify/memory/release.md
// (checks, the release commands, the person's part); its code gaps become tasks, and its commands run only after the
// person's yes. The rail below holds every deploy, submit and publish until then. Pure: register.tsx reads the files.

import type { Ledger, ReleaseNote, Snapshot } from '../types'
import { acceptanceCounts } from './accept'
import { fingerprint, specFingerprint } from './rules'
import { evaluate } from './xref'

export const RELEASE = '.specify/memory/release.md'

/** What the release check and the release write about the app, not into it: release.md and the local build output. */
export const SHIP_ARTIFACT = /(^|\/)\.specify\/memory\/release\.md$|^(dist|web-build|build|out)\//

/** The deploy CLIs the mod looks for, on PATH or in the project, by the package that brings each. */
export const DEPLOY_TOOLS: Record<string, string> = { eas: 'eas-cli', wrangler: 'wrangler', vercel: 'vercel', netlify: 'netlify-cli', firebase: 'firebase-tools', fastlane: '' }

/** The deploy CLIs package.json brings: they run through npx without a download. */
export function deployToolsOf(packageJson: string | null): string[] {
  let deps: Record<string, unknown> = {}
  try {
    const pkg = JSON.parse(packageJson ?? '') as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return []
  }
  return Object.entries(DEPLOY_TOOLS).filter(([, pkg]) => pkg && pkg in deps).map(([name]) => name)
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.replace(/`/g, '').trim())
const plain = (text: string) => text.replace(/\*\*|`/g, '').trim()

function resultOf(text: string): ReleaseNote['checks'][number]['result'] {
  const t = text.toLowerCase()
  if (/your part|person|manual|dein teil/.test(t)) return 'your part'
  if (/^(fail|✗|✖|no\b)|→\s*t\d/.test(t)) return 'fail'
  if (/^(pass|ok|✓|✔|yes\b)/.test(t)) return 'pass'
  return 'n/a'
}

/** `.specify/memory/release.md` as the mod reads it (the format the speckit-xref:ship skill gives). */
export function parseRelease(markdown: string): ReleaseNote {
  const field = (name: string) => new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi').exec(markdown)?.[1]?.trim() ?? null
  const ready = field('Ready')
  const note: ReleaseNote = {
    version: field('Version'),
    targets: (field('Targets') ?? '').split(/,\s*/).map(plain).filter(Boolean),
    ready: ready === null ? null : /^yes\b/i.test(ready),
    readyNote: ready?.replace(/^(yes|no)\s*[—–:-]?\s*/i, '') || null,
    checks: [],
    commands: [],
    yourPart: [],
    releases: [],
    fingerprint: '',
  }
  let section = ''
  let when: 'before' | 'after' = 'before'
  let fence = false
  const kept: string[] = []
  for (const line of markdown.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      const title = h[1]!.toLowerCase()
      section = /^checks?/.test(title) ? 'checks' : /command/.test(title) ? 'commands' : /your part|dein teil/.test(title) ? 'yours' : /^releases?\b/.test(title) ? 'releases' : ''
      when = 'before'
    }
    if (section !== 'releases') kept.push(line)
    if (h) continue
    if (/^```/.test(line.trim())) {
      fence = !fence
      continue
    }
    if (section === 'commands') {
      const command = fence ? line.trim() : /^\s*(?:\d+[.)]|[-*])\s+`([^`]+)`/.exec(line)?.[1]?.trim()
      if (command && !command.startsWith('#')) note.commands.push(command)
    } else if (section === 'yours') {
      if (/^(?:###\s+)?\**\s*after\b/i.test(line.trim())) when = 'after'
      else if (/^(?:###\s+)?\**\s*before\b/i.test(line.trim())) when = 'before'
      const item = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line)
      if (item) note.yourPart.push({ text: plain(item[2]!), done: !!item[1] && item[1] !== ' ', when })
    } else if ((section === 'checks' || section === 'releases') && /^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
      const c = cells(line)
      if (section === 'checks' && c.length >= 3 && !/^area$/i.test(c[0]!)) note.checks.push({ area: c[0]!, check: c[1]!, result: resultOf(c[2]!), evidence: c[3] ?? '' })
      if (section === 'releases' && c.length >= 4 && !/^date$/i.test(c[0]!)) note.releases.push({ date: c[0]!, version: c[1]!, target: c[2]!, ok: /^(shipped|ok|pass|✓|✔|live|submitted)/i.test(c[3]!), where: c[4] ?? '' })
    }
  }
  // The person approves the plan; the log the release appends to is not part of it.
  note.fingerprint = fingerprint(kept.join('\n'))
  return note
}

/** One line for the pane and the review: `v1.0.0 → web, ios · 14 pass · 2 your part`. */
export function releaseLine(release: ReleaseNote | null | undefined): string {
  if (!release) return 'no release check yet'
  const pass = release.checks.filter(c => c.result === 'pass').length
  const fail = release.checks.filter(c => c.result === 'fail').length
  const yours = release.yourPart.filter(y => !y.done).length
  return [
    `${release.version ? `v${release.version.replace(/^v/i, '')}` : 'no version'} → ${release.targets.join(', ') || 'no target'}`,
    `${pass} pass`,
    ...(fail ? [`${fail} fail${fail === 1 ? 's' : ''}`] : []),
    ...(yours ? [`${yours} your part`] : []),
  ].join(' · ')
}

/**
 * What holds a release, before any model looks: the tests, the drift, a failing acceptance scenario, a spec nobody
 * approved; then what release.md itself says: not ready, a failing check, the person's part before the release, no command.
 */
export function releaseBlockers(snap: Snapshot, ledger: Ledger, lastTest: { ok: boolean } | null, specGate: boolean): string[] {
  const out: string[] = []
  if (lastTest && !lastTest.ok) out.push('the tests fail')
  if (evaluate(snap, ledger).level === 'red') out.push('the drift is red')
  const failing = acceptanceCounts(snap, ledger).failing
  if (failing) out.push(`${failing} acceptance scenario${failing === 1 ? '' : 's'} fail${failing === 1 ? 's' : ''}`)
  // As the workflow counts it: a project planned before the spec review existed counts as reviewed until its spec changes.
  const specApproved = !snap.spec || (ledger.approvals.spec ? ledger.approvals.spec === specFingerprint(snap.spec) : snap.hasPlan)
  if (specGate && !specApproved) out.push('the spec is not approved (Approve spec in the pane)')
  const release = snap.release
  if (!release) return [...out, `the release check wrote no ${RELEASE}`]
  if (release.ready === false) out.push(`${RELEASE} says it is not ready${release.readyNote ? `: ${release.readyNote}` : ''}`)
  const failed = release.checks.filter(c => c.result === 'fail')
  if (failed.length) out.push(`${failed.length} check${failed.length === 1 ? '' : 's'} fail${failed.length === 1 ? 's' : ''} (${failed.slice(0, 3).map(c => c.check).join('; ')})`)
  const before = release.yourPart.filter(y => !y.done && y.when === 'before')
  if (before.length) out.push(`your part before the release: ${before.slice(0, 3).map(y => y.text).join('; ')}${before.length > 3 ? ` (+${before.length - 3})` : ''}`)
  if (!release.commands.length) out.push(`${RELEASE} names no release command`)
  return out
}

/** What the release check hands Claude: the targets, the tools on this machine, the rules. Nothing goes out in it. */
export function shipPrompt(snap: Snapshot): string {
  const dir = snap.featureDir ?? 'specs/<feature>'
  const p = snap.platforms ?? { web: false, ios: false, android: false }
  const targets = [p.web ? 'web' : null, p.ios ? 'iOS' : null, p.android ? 'Android' : null].filter(Boolean).join(', ') || "the platforms plan.md names"
  const tools = snap.tools.deploy ?? []
  return [
    `Check that the app is ready to release, with the speckit-xref:ship skill, and write ${RELEASE} in the format it gives. Nothing goes out in this step: no deploy, no store build, no submit, no publish, no push.`,
    ...(snap.testCommand ? [`The mod ran the test suite (\`${snap.testCommand}\`) right before this step and stops on a failure: do not run it again.`] : []),
    `Targets: ${targets}. Deploy tools on this machine: ${tools.length ? tools.join(', ') : 'none'}. Never run npx with a package the project does not have (eas-cli, wrangler, lighthouse, serve …): a missing tool is the person's part.`,
    'Check: the version and build numbers; the store fields (app name, bundle identifier, Android package, icon, splash); a usage text for every OS permission the code asks for; privacy (what leaves the device, a privacy-policy URL; the stores\' privacy answers drafted under Your part); accessibility (labels on controls, the contrast of DESIGN.md\'s colours); secrets (no .env, *.p8, *.p12, keystore or service-account file tracked by git; .env.example names every variable the code reads; name paths, never values); the production build, run locally where it needs no account (e.g. `npx expo export -p web`), with its size.',
    `Rate each finding as verify does: HIGH (blocks the release or breaks a store rule), MEDIUM (a user or a reviewer would hit it), LOW (polish). HIGH and MEDIUM findings that are code or configuration work become tasks under '## Phase N: Release readiness' in ${dir}/tasks.md (the next free T### ids, the files in backticks); list the LOW ones in your answer under 'Low, no task'. Do not change the app in this step.`,
    `Write the release commands the person will approve: the exact commands, in order, with the tools that are here. What only the person can do (an account, a login, a key, a store listing, a review, testers) goes under Your part, split into before and after the release.`,
  ].join('\n')
}

/** The release step: the commands the person approved, once each, and a row in the log. */
export function releasePrompt(release: ReleaseNote): string {
  return [
    `The person approved this release (${RELEASE}). Run its release commands now, in order, once each:`,
    ...release.commands.map((c, i) => `${i + 1}. \`${c}\``),
    'A command that asks for a login, a password, a two-factor code or any interactive answer: stop there and do not work around it; add it to Your part before the release. Stop at the first command that fails.',
    `Then append a row to '## Releases' in ${RELEASE}: | today's date (YYYY-MM-DD) | version | target | shipped or failed | the URL, the build id or the error |, one per target. Do not change the app, do not commit, do not push.`,
  ].join('\n')
}

// ---- The rail: what releases the app waits for the person ----

/** Where a word is a command, not an argument (`ls fastlane` is no release): at the start, after `;` `&&` `|` `(`, or `npx`, `exec` and the like. */
const AT_COMMAND = String.raw`(?:^\s*|[;&|(]\s*|\b(?:npx|bunx|exec|dlx|sudo|env|time)\s+)(?:\w+=\S*\s+)*`

const RELEASING: RegExp[] = [
  /\beas(?:-cli(?:@\S+)?)?\s+(?:build|submit|update)(?![:\w-])/,
  /\bexpo(?:-cli)?\s+publish\b/,
  /\bwrangler(?:@\S+)?\s+(?:pages\s+)?(?:deploy|publish)\b|\bwrangler(?:@\S+)?\s+versions\s+(?:upload|deploy)\b/,
  new RegExp(String.raw`${AT_COMMAND}vercel(?:@\S+)?(?=\s|$)(?!\s+(?:dev|build|env|login|logout|whoami|link|pull|ls|list|inspect|logs|help|--version|-v)\b)`),
  /\bnetlify(?:-cli)?\s+deploy\b/,
  /\bfirebase(?:-tools)?\s+(?:deploy|hosting:channel:deploy)\b/,
  new RegExp(String.raw`${AT_COMMAND}fastlane(?=\s|$)(?!\s+(?:init|lanes|list|env|help|--version|-v)\b)`),
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:deploy|release|publish|ship)\b/,
  /\bgh\s+release\s+create\b/,
  /\b(?:fly|flyctl)\s+deploy\b/,
  /\bsupabase\s+(?:functions\s+deploy|db\s+push)\b/,
  /\bdocker\s+push\b/,
  /\bgcloud\b.*\bdeploy\b/,
  /\bxcrun\s+altool\b.*--upload/,
]

/** Whether a shell command releases the app: deploys, builds or submits for a store, publishes. Asking a tool for its help does not. */
export const releasesApp = (command: string) =>
  command
    .split(/\n|;|&&|\|\|?/)
    .some(part => !/\s(?:--help|-h)(?:\s|$)/.test(part) && RELEASING.some(re => re.test(part)))

/** An MCP tool that deploys, publishes or submits (`deploy_worker`, `submit_build`); reading tools pass. */
export function releasesByTool(tool: string): boolean {
  if (!tool.startsWith('mcp__')) return false
  const name = tool.slice(tool.lastIndexOf('__') + 2).toLowerCase()
  if (/^(get|list|read|search|describe|fetch|view|show|find)[_-]/.test(name)) return false
  return /(?:^|[_-])(deploy|publish|submit|release|rollback|promote)(?:$|[_-])/.test(name)
}
