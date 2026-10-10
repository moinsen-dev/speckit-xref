import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Autopilot, Ledger, NextWork, RunEntry, Snapshot } from '../types'
import { renderDashboard } from './dashboard'
import type { DashboardDoc } from './dashboard'
import { NEXT_LABELS, RUNBOOK, doneAsk, nextKindOf, parsePhaseNotes, parseQuickstart, treeOf, verifyKey } from './brief'
import { DESIGN_FILE, designChangeFromGit, designDir, designState, designTokens, screensPath, uiFromPlan } from './design'
import { LOCAL_IGNORE, ledgerFromParts, ledgerToParts, localPath, rebaseline, runLogPath } from './ledger'
import { LADDER, isActive, levelOf, parseJunit, verificationFrom, verificationFromExit } from './proof'
import type { Rung } from './proof'
import { featureFromBranch, fingerprint, hasRealTests, isTestFile, matchesAny, rulesFrom, specFingerprint } from './rules'
import { invokeSeparator, parseConstitution, parseFeatureJson, parseSpec, parseTasks } from './speckit'
import type { Flow, Review, Step } from './workflow'
import {
  AUTONOMY_RULES,
  REVIEWS,
  QUESTION_LABELS,
  autopilotPrompt,
  endsWithQuestion,
  idleAutopilot,
  nextStep,
  openChecklistItems,
  openPhase,
  persistenceModel,
  progressKey,
  MAX_REPAIRS,
  phaseStrip,
  setupNote,
  stepLine,
  takesIdea,
  couldNotRun,
  failureLine,
  parseIdeaBrief,
  phaseLabel,
  phaseNumber,
  specReview,
  taskPhases,
  tasksFingerprint,
  testCommandFrom,
  testScriptCommand,
} from './workflow'
import {
  acknowledgeAll,
  anchorsIn,
  appendRemediation,
  applyMapping,
  applySemantic,
  classify,
  composeSection,
  currentTask,
  editNote,
  emptyLedger,
  evaluate,
  isSpecArtifact,
  forkPrompt,
  link,
  logIntent,
  mapPrompt,
  parseSemantic,
  recordTouch,
  relPath,
  reqsOf,
  resolveIntent,
  openUnplanned,
  short,
  speckitCommand,
  turnContext,
} from './xref'
import type { Anchor } from '../types'
import type { Classified, Level, Report } from './xref'

type $ = EngineInterface
type Options = {
  mode: string
  driftCheck: string
  mapModel: string
  autopilot: string
  autopilotMaxSteps: number
  testCommand: string
  junitPath: string
  review: string
  commitPerTask: string
  parallel: string
  pane: string
  validate: string
  shape: string
  design: string
  allowPush: string
}

const PLUGIN = 'speckit-xref'
const PANE = 'speckit-xref'
const TITLE = 'Spec X-Ref'
const COMMAND = 'xref'
const STOP_COMMAND = 'xref-stop'
const REFRESH_MS = 4000
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
// Prompts the person typed, wherever they typed them; a plugin's or a peer's are not their intent.
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const LEVEL_COLOR = { none: 'subtle', green: 'success', yellow: 'warning', red: 'error' } as const
const RANK: Record<Level, number> = { none: 0, green: 1, yellow: 2, red: 3 }
// What the person reads: a word and a glyph, the color only on top.
const STATE: Record<Level, { glyph: string; word: string }> = {
  none: { glyph: '·', word: 'no feature' },
  green: { glyph: '●', word: 'ok' },
  yellow: { glyph: '▲', word: 'watch' },
  red: { glyph: '✖', word: 'off-spec' },
}
// `@spec` and every id after it on the line (§5): -o prints the whole list, anchorsIn splits it.
const RG_ID = '(?:[\\w.-]+/)?(?:(?:FR|SC)-\\d{3,}|T-?\\d{3,}|US\\d+-AS\\d+)'
const ANCHOR_RG = `@spec\\s+${RG_ID}(?:[ \\t,]+${RG_ID})*`
const GIT_ID = '([[:alnum:]_.-]+/)?((FR|SC)-[0-9]{3,}|T-?[0-9]{3,}|US[0-9]+-AS[0-9]+)'
const ANCHOR_GIT = `@spec[[:space:]]+${GIT_ID}([[:blank:],]+${GIT_ID})*`

const snapshotA = atom({ plugin: 'speckit-xref', key: 'snapshot' } as const, null)
const ledgerA = atom({ plugin: 'speckit-xref', key: 'ledger' } as const, emptyLedger())
const activeA = atom({ plugin: 'speckit-xref', key: 'active' } as const, null)
const checkingA = atom({ plugin: 'speckit-xref', key: 'checking' } as const, false)
const autopilotA = atom({ plugin: 'speckit-xref', key: 'autopilot' } as const, idleAutopilot())
// Turn state lives in atoms, so a reload or a /config change in the middle of a turn keeps it.
const askedA = atom({ plugin: 'speckit-xref', key: 'asked' } as const, null)
const turnFilesA = atom({ plugin: 'speckit-xref', key: 'turnFiles' } as const, [] as string[])
const turnA = atom({ plugin: 'speckit-xref', key: 'turn' } as const, null)
const detailsA = atom({ plugin: 'speckit-xref', key: 'details' } as const, false)
const seenAtA = atom({ plugin: 'speckit-xref', key: 'seenAt' } as const, 0)
const chipsA = atom({ plugin: 'speckit-xref', key: 'chips' } as const, {} as Record<string, string>)
const queueA = atom({ plugin: 'speckit-xref', key: 'queue' } as const, { auto: false, person: false })
// What the person allowed once through the ask tool: a rail's label and until when it holds.
const permitsA = atom({ plugin: 'speckit-xref', key: 'permits' } as const, [] as { label: string; until: number }[])

// The module's own: they start over on a reload, and session.start or register fills them again.
let root = ''
let signature = ''
let offered = false
let interactive = true
let lastLevel: Level = 'none'
let timer: { cancel: () => void } | null = null
// What can run Spec Kit's CLI here, looked up once a session.
let cli = { specify: false, uvx: false }
let mapModel = 'haiku'
let defaultMax = 25
let testCommandOption = ''
let junitPath = ''
let review: Review = 'spec+design'
// Read by the strict guard's fallback, which has to be a top-level function.
let strict = false
let parallel = false
let commitPerTask = false
// When the pane opens without being asked: auto (where it is a sidebar), always (every Spec Kit project), off.
let paneMode: 'auto' | 'always' | 'off' = 'auto'
let driftCheckOn = true
let validateOn = true
let shapeOn = true
let designOn = true
// On: the autopilot may push a feature branch (never main, never --force) once the tests are green.
let allowPush = false
// In a `-p` run the next step rides the Stop hook's re-prompt instead of a prompt of its own.
let pendingPrompt: string | null = null
// When the step running now was handed over: its length in the run log, where a -p run reports none.
let stepStartedAt = 0

const at = (rel: string) => (rel.startsWith('/') ? rel : `${root}/${rel}`)
const at$ = at
const stamp = async ($: $) => new Date(await $.clock.now()).toISOString()

async function readText($: $, rel: string): Promise<string | null> {
  try {
    return await $.fs.read(at(rel))
  } catch {
    return null
  }
}

async function mtime($: $, rel: string): Promise<number> {
  try {
    return (await $.fs.stat(at(rel))).mtimeMs
  } catch {
    return 0
  }
}

async function exists($: $, rel: string): Promise<boolean> {
  try {
    return await $.fs.exists(at(rel))
  } catch {
    return false
  }
}

/**
 * The project root: the nearest folder at or above the working directory that holds `.specify/`, as Spec Kit's
 * own scripts find it. Claude started in a subfolder of a Spec Kit project must not be offered a nested setup.
 */
async function projectRoot($: $, cwd: string): Promise<string> {
  let dir = cwd.replace(/\/+$/, '') || '/'
  for (let depth = 0; depth < 16; depth++) {
    if (await $.fs.exists(`${dir === '/' ? '' : dir}/.specify`).catch(() => false)) return dir
    const parent = dir.slice(0, dir.lastIndexOf('/')) || '/'
    if (parent === dir) break
    dir = parent
  }
  return cwd
}

const IGNORABLE = /^(\.|README|LICENSE|CHANGELOG)/i

/** Empty: nothing at the top but dotfiles, a README, a license or a changelog. */
async function folderKind($: $): Promise<'empty' | 'existing'> {
  try {
    return (await $.fs.list(root)).some(entry => !IGNORABLE.test(entry.name)) ? 'existing' : 'empty'
  } catch {
    return 'existing'
  }
}

/** Whether a program is on the PATH. */
async function onPath($: $, program: string): Promise<boolean> {
  try {
    return (await $.process.run(['which', program], { cwd: root, timeoutMs: 3000 })).exitCode === 0
  } catch {
    return false
  }
}

/** Every feature directory with a spec.md, and when its spec or tasks last changed. */
async function listFeatures($: $): Promise<{ dir: string; time: number }[]> {
  const found: { dir: string; time: number }[] = []
  for (const base of ['specs', '.specify/specs']) {
    let entries
    try {
      entries = await $.fs.list(at(base))
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.kind !== 'dir') continue
      const dir = `${base}/${entry.name}`
      const spec = await mtime($, `${dir}/spec.md`)
      if (spec) found.push({ dir, time: Math.max(spec, await mtime($, `${dir}/tasks.md`)) })
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir))
}

/** The git branch checked out; null outside git or on a detached HEAD. */
async function currentBranch($: $): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeoutMs: 3000 })
    const branch = ran.exitCode === 0 ? ran.stdout.trim() : ''
    return branch && branch !== 'HEAD' ? branch : null
  } catch {
    return null
  }
}

/**
 * The active feature, as docs/contract-0.4.md §7 orders it: SPECIFY_FEATURE_DIRECTORY, .specify/feature.json,
 * SPECIFY_FEATURE, the feature the git branch names (`001-…`), else the spec written last.
 */
async function resolveFeature($: $, features?: { dir: string; time: number }[], branch?: string | null): Promise<string | null> {
  const named = await $.env.get('SPECIFY_FEATURE')
  const pointers = [
    await $.env.get('SPECIFY_FEATURE_DIRECTORY'),
    parseFeatureJson((await readText($, '.specify/feature.json')) ?? ''),
    named ? `specs/${named}` : null,
  ]
  for (const pointer of pointers) {
    if (!pointer) continue
    const rel = relPath(pointer, root).replace(/\/$/, '')
    if (await exists($, `${rel}/spec.md`)) return rel
  }
  const all = features ?? (await listFeatures($))
  const fromBranch = featureFromBranch(branch === undefined ? ((await currentBranch($)) ?? '') : (branch ?? ''), all.map(f => f.dir))
  if (fromBranch) return fromBranch
  const latest = [...all].sort((a, b) => b.time - a.time)[0]
  return latest?.dir ?? null
}

async function currentSignature($: $, featureDir: string | null): Promise<string> {
  const files = ['.specify/feature.json', '.specify/memory/constitution.md', '.specify/integration.json', '.specify/extensions.yml']
  if (featureDir) files.push(`${featureDir}/spec.md`, `${featureDir}/tasks.md`, `${featureDir}/plan.md`, '.xrefignore', 'package.json', DESIGN_FILE, screensPath(featureDir), `${featureDir}/quickstart.md`, RUNBOOK)
  const times = await Promise.all(files.map(f => mtime($, f)))
  return [featureDir ?? '-', ...times].join('|')
}

/** Reads Spec Kit's files into the snapshot; a new feature brings its own ledger. */
async function scan($: $): Promise<void> {
  const features = await listFeatures($)
  const branch = await currentBranch($)
  const featureDir = await resolveFeature($, features, branch)
  const [specMd, tasksMd, planMd, constitutionMd, integrationJson, initOptions, ignoreText, designMd, screensMd] = await Promise.all([
    featureDir ? readText($, `${featureDir}/spec.md`) : null,
    featureDir ? readText($, `${featureDir}/tasks.md`) : null,
    featureDir ? readText($, `${featureDir}/plan.md`) : null,
    readText($, '.specify/memory/constitution.md'),
    readText($, '.specify/integration.json'),
    readText($, '.specify/init-options.json'),
    readText($, '.xrefignore'),
    readText($, DESIGN_FILE),
    featureDir ? readText($, screensPath(featureDir)) : null,
  ])
  const [quickstartMd, runbookMd] = await Promise.all([featureDir ? readText($, `${featureDir}/quickstart.md`) : null, readText($, RUNBOOK)])
  let extensions: string[] = []
  try {
    extensions = (await $.fs.list(at('.specify/extensions'))).filter(e => e.kind === 'dir' && !e.name.startsWith('.')).map(e => e.name)
  } catch {
    extensions = []
  }
  // integration.json says how commands are invoked; without it, a commands-only layout is the old one.
  const separator = integrationJson ? invokeSeparator(integrationJson) : null
  const commandsOnly = separator ? separator === '.' : (await exists($, '.claude/commands/speckit.clarify.md')) && !(await exists($, '.claude/skills/speckit-clarify/SKILL.md'))
  const tasks = tasksMd ? parseTasks(tasksMd) : []
  const previous = await read($, snapshotA)
  const snapshot: Snapshot = {
    initialized: await exists($, '.specify'),
    featureDir,
    features: features.map(f => f.dir),
    hasPlan: planMd !== null,
    extensions,
    claudeIntegration: await hasClaudeIntegration($),
    speckitVersion: speckitVersionOf(initOptions),
    tools: cli,
    folder: await folderKind($),
    spec: specMd ? parseSpec(specMd) : null,
    tasks,
    constitution: constitutionMd ? parseConstitution(constitutionMd) : null,
    commandStyle: commandsOnly ? 'commands' : 'skills',
    rules: rulesFrom(ignoreText),
    realTests: previous?.featureDir === featureDir ? previous.realTests : [],
    planFingerprint: planMd ? fingerprint(planMd) : null,
    // The option, else the project's own test script, else what plan.md's Testing line implies.
    testCommand: testCommandOption || (await projectTestScript($)) || testCommandFrom(planMd),
    branch,
    phase: openPhase(tasks),
    tasksFingerprint: tasksFingerprint(tasks),
    commands: await installedCommands($),
    checklists: featureDir ? await checklists($, featureDir) : [],
    persistence: persistenceModel(constitutionMd),
    commits: await hasCommits($),
    ...(await ideaState($)),
    ui: uiFromPlan(planMd),
    design: featureDir ? designState(designMd, screensMd) : null,
    phaseNotes: tasksMd ? parsePhaseNotes(tasksMd) : {},
    quickstart: quickstartMd ? parseQuickstart(quickstartMd) : [],
    runbook: runbookMd,
    ...(featureDir ? await gitState($) : { head: null, tree: null }),
  }
  // At the design review the mod checks screens.md's word on DESIGN.md against git, where there is a commit to compare with.
  if (snapshot.design?.screens && tasks.length === 0 && snapshot.commits) snapshot.design.verified = await designGit($)
  if (!previous || previous.featureDir !== featureDir) {
    const ledger = featureDir ? rebaseline(ledgerFromParts(await readText($, `${featureDir}/xref.json`), await readText($, localPath(featureDir))), specMd) : emptyLedger()
    const anchors = featureDir ? await scanAnchors($) : null
    await update($, ledgerA, () => (anchors ? { ...ledger, anchors } : ledger))
    await update($, activeA, () => null)
    snapshot.realTests = await findRealTests($, anchors ? { ...ledger, anchors } : ledger)
  }
  await update($, snapshotA, () => snapshot)
  signature = await currentSignature($, featureDir)
}

async function projectTestScript($: $): Promise<string | null> {
  const pkg = await readText($, 'package.json')
  if (!pkg) return null
  return testScriptCommand(pkg, { pnpm: await exists($, 'pnpm-lock.yaml'), yarn: await exists($, 'yarn.lock'), bun: (await exists($, 'bun.lock')) || (await exists($, 'bun.lockb')) })
}

const IDEA_BRIEF = '.specify/memory/idea-brief.md'
const PRODUCT_BRIEF = '.specify/memory/product-brief.md'
const PROJECT_STATE = '.specify/xref/local/project.json'

/** The idea's state before the first feature: the brief Validate wrote, the person's decision on it, Shape's brief. */
async function ideaState($: $): Promise<Pick<Snapshot, 'ideaBrief' | 'ideaDecision' | 'productBrief'>> {
  const brief = await readText($, IDEA_BRIEF)
  let decision: Snapshot['ideaDecision'] = null
  try {
    const raw = JSON.parse((await readText($, PROJECT_STATE)) ?? '{}') as { idea?: Snapshot['ideaDecision'] }
    if (raw.idea && (raw.idea.decision === 'build' || raw.idea.decision === 'drop')) decision = raw.idea
  } catch {
    decision = null
  }
  return { ideaBrief: brief ? parseIdeaBrief(brief) : null, ideaDecision: decision, productBrief: await exists($, PRODUCT_BRIEF) }
}

/**
 * The person decides on the idea brief: Build goes on, Drop stops the run. Kept in the local project state with the
 * brief's fingerprint, so only the person's press counts and a rewritten brief asks again; the brief shows the line.
 */
async function decideIdea($: $, decision: 'build' | 'drop'): Promise<string> {
  const snap = await read($, snapshotA)
  const brief = snap?.ideaBrief
  if (!brief) return 'No idea brief to decide on.'
  const at = await stamp($)
  let state: Record<string, unknown> = {}
  try {
    state = JSON.parse((await readText($, PROJECT_STATE)) ?? '{}') as Record<string, unknown>
  } catch {
    state = {}
  }
  await $.fs.write(at$(PROJECT_STATE), JSON.stringify({ ...state, idea: { decision, fingerprint: brief.fingerprint, at } }, null, 2) + '\n')
  if (!(await exists($, LOCAL_IGNORE.path))) await $.fs.write(at$(LOCAL_IGNORE.path), LOCAL_IGNORE.text)
  const text = (await readText($, IDEA_BRIEF)) ?? ''
  const line = `**Decision**: ${decision} (the person, ${at.slice(0, 10)})`
  const lines = text.split('\n').filter(l => !/^\*\*Decision\*\*:/i.test(l))
  const after = lines.findIndex(l => /^\*\*(Recommendation|Score)\*\*:/i.test(l))
  lines.splice(after >= 0 ? after + 1 : 1, 0, line)
  await $.fs.write(at$(IDEA_BRIEF), lines.join('\n'))
  await scan($)
  const ap = await read($, autopilotA)
  if (decision === 'drop') {
    if (ap.on) await stopAutopilot($, `Idea dropped: "${brief.title}". The brief stays in ${IDEA_BRIEF}.`)
    return `Dropped the idea "${brief.title}".`
  }
  if (ap.on && ap.paused) await resumeAutopilot($)
  return `Building "${brief.title}": shape, constitution and spec come next.`
}

/** Sharpen: the person says what should change, and Validate runs again on the sharper idea. */
async function sharpenIdea($: $): Promise<void> {
  let change = ''
  try {
    change = await $.ui.ask('What should change about the idea?', { options: ['Narrow the audience', 'Change the core feature'], header: 'Sharpen' })
  } catch {
    return
  }
  if (!change.trim()) return
  if ((await read($, autopilotA)).paused) await update($, autopilotA, a => ({ ...a, paused: null, stalls: 0 }))
  void $.prompt.submit({ text: `Sharpen the idea: ${change}. Run the speckit-xref:validate skill again on the sharper idea and rewrite ${IDEA_BRIEF}.`, asUser: true })
}

/** A dropped idea reopens, or a new one starts: the old brief moves aside, the decision goes. */
async function reopenIdea($: $, fresh: boolean): Promise<string> {
  let state: Record<string, unknown> = {}
  try {
    state = JSON.parse((await readText($, PROJECT_STATE)) ?? '{}') as Record<string, unknown>
  } catch {
    state = {}
  }
  delete state.idea
  await $.fs.write(at$(PROJECT_STATE), JSON.stringify(state, null, 2) + '\n')
  if (fresh) {
    const text = await readText($, IDEA_BRIEF)
    if (text !== null) {
      // Moved aside, never deleted: the old brief stays readable beside the new one.
      await $.process.run(['mv', '--', at$(IDEA_BRIEF), at$(`.specify/memory/idea-brief-${(await stamp($)).slice(0, 10)}-dropped.md`)], { cwd: root, timeoutMs: 3000 }).catch(() => undefined)
    }
    await update($, autopilotA, a => ({ ...a, idea: null }))
  }
  await scan($)
  return fresh ? 'The old brief is kept beside it; describe the new idea.' : 'The idea is open again: Build, Sharpen or Drop.'
}

const DASHBOARD = '.specify/xref/local/dashboard.html'

/** The documents the dashboard shows in place: Spec Kit's artifacts of the feature, the constitution, the briefs. */
async function dashboardDocs($: $, featureDir: string): Promise<DashboardDoc[]> {
  const docs: DashboardDoc[] = []
  const add = async (path: string, title: string) => {
    const markdown = await readText($, path)
    if (markdown !== null) docs.push({ path, title, markdown })
  }
  for (const [name, title] of [['spec.md', 'Spec'], ['plan.md', 'Plan'], ['tasks.md', 'Tasks'], ['research.md', 'Research'], ['data-model.md', 'Data model'], ['quickstart.md', 'Quickstart']] as const) {
    await add(`${featureDir}/${name}`, title)
  }
  for (const dir of ['contracts', 'checklists']) {
    try {
      for (const e of await $.fs.list(at(`${featureDir}/${dir}`))) if (e.kind === 'file' && e.name.endsWith('.md')) await add(`${featureDir}/${dir}/${e.name}`, `${dir}/${e.name}`)
    } catch {
      // The feature has none.
    }
  }
  await add(screensPath(featureDir), 'Screens')
  await add(DESIGN_FILE, 'Design system')
  await add('.specify/memory/constitution.md', 'Constitution')
  await add(IDEA_BRIEF, 'Idea brief')
  await add(PRODUCT_BRIEF, 'Product brief')
  return docs
}

/** Writes the dashboard: after every step and on /xref web, never on every edit. Local and git-ignored. */
async function writeDashboard($: $): Promise<string | null> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return null
  const ledger = await read($, ledgerA)
  const ap = await read($, autopilotA)
  const report = evaluate(snap, ledger)
  const proof = { featureDir: snap.featureDir, tasks: snap.tasks, reqs: snap.spec?.reqs ?? [], realTests: snap.realTests }
  const levels: Record<string, Rung> = {}
  for (const r of snap.spec?.reqs ?? []) if (r.kind === 'FR' && isActive(r)) levels[r.id] = levelOf(r.id, proof, ledger)
  const step = nextStep(snap, ledger, ap.idea, flowOf(ap))
  const html = renderDashboard({
    generatedAt: await stamp($),
    root,
    snap,
    ledger,
    report,
    levels,
    step: { phase: step.phase, line: stepLine(step), needsUser: step.needsUser },
    strip: phaseStrip(snap, step, review !== 'none' && specReview(snap, ledger) !== 'approved'),
    autopilot: ap,
    runLog: await runLog($),
    docs: await dashboardDocs($, snap.featureDir),
    design: snap.design?.screens
      ? { dir: designDir(snap.featureDir), screens: snap.design.screens, tokens: designTokens((await readText($, DESIGN_FILE)) ?? ''), approved: ledger.approvals.design === snap.design.fingerprint }
      : null,
    refreshSeconds: 5,
  })
  try {
    if (!(await exists($, LOCAL_IGNORE.path))) await $.fs.write(at(LOCAL_IGNORE.path), LOCAL_IGNORE.text)
    await $.fs.write(at(DASHBOARD), html)
    return at(DASHBOARD)
  } catch {
    return null
  }
}

/** Writes the dashboard and opens it in the default browser; where nothing opens it, the path is the way in. */
async function openDashboard($: $): Promise<string> {
  await scan($)
  const path = await writeDashboard($)
  if (!path) return 'No Spec Kit feature yet: the dashboard starts with the first spec.'
  const opener = (await $.process.run(['uname'], { cwd: root, timeoutMs: 3000 }).catch(() => null))?.stdout.trim() === 'Darwin' ? 'open' : 'xdg-open'
  const opened = await $.process.run([opener, path], { cwd: root, timeoutMs: 5000 }).then(r => r.exitCode === 0).catch(() => false)
  return `${opened ? 'Dashboard opened' : 'Dashboard written'}: file://${path}\nIt reloads itself and is rewritten after every step. Local only: it holds your own words.`
}

/** HEAD and the uncommitted changes, for the verification that marks a feature done; null where git cannot say. */
async function gitState($: $): Promise<{ head: string | null; tree: string | null }> {
  try {
    const head = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd: root, timeoutMs: 3000 })
    const status = await $.process.run(['git', 'status', '--porcelain'], { cwd: root, timeoutMs: 5000 })
    return { head: head.exitCode === 0 ? head.stdout.trim() : null, tree: status.exitCode === 0 ? treeOf(status.stdout) : null }
  } catch {
    return { head: null, tree: null }
  }
}

/** What git shows for DESIGN.md since the last commit; null where git cannot say. */
async function designGit($: $): Promise<'created' | 'extended' | 'unchanged' | null> {
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain', '--', DESIGN_FILE], { cwd: root, timeoutMs: 3000 })
    return ran.exitCode === 0 ? designChangeFromGit(ran.stdout) : null
  } catch {
    return null
  }
}

/** Whether the repository has a commit: true, false (a repository without one), null (no git here). */
async function hasCommits($: $): Promise<boolean | null> {
  try {
    const inside = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'], { cwd: root, timeoutMs: 3000 })
    if (inside.exitCode !== 0) return null
    return (await $.process.run(['git', 'rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, timeoutMs: 3000 })).exitCode === 0
  } catch {
    return null
  }
}

/** Spec Kit's commands installed for Claude Code, by name without prefix: `plan`, `analyze`, `xref-check`. */
async function installedCommands($: $): Promise<string[]> {
  const names = new Set<string>()
  try {
    for (const e of await $.fs.list(at('.claude/skills'))) if (e.kind === 'dir' && e.name.startsWith('speckit-')) names.add(e.name.slice('speckit-'.length))
  } catch {
    // No skills folder: the commands layout, or no integration.
  }
  try {
    for (const e of await $.fs.list(at('.claude/commands'))) {
      const m = /^speckit\.(.+)\.md$/.exec(e.name)
      if (m) names.add(m[1]!.replace(/\./g, '-'))
    }
  } catch {
    // No commands folder.
  }
  return [...names].sort()
}

/** The feature's checklists with open items. */
async function checklists($: $, featureDir: string): Promise<{ file: string; open: number }[]> {
  const files: Record<string, string> = {}
  try {
    for (const e of await $.fs.list(at(`${featureDir}/checklists`))) {
      if (e.kind !== 'file' || !e.name.endsWith('.md')) continue
      const text = await readText($, `${featureDir}/checklists/${e.name}`)
      if (text !== null) files[`checklists/${e.name}`] = text
    }
  } catch {
    return []
  }
  return openChecklistItems(files)
}

/** The test files tied to the feature (anchored, linked or touched) that hold real tests, not only test.todo. */
async function findRealTests($: $, ledger: Ledger): Promise<string[]> {
  const candidates = new Set<string>()
  for (const a of ledger.anchors) candidates.add(a.file)
  for (const r of Object.values(ledger.requirements)) r.files.forEach(f => candidates.add(f))
  for (const t of Object.values(ledger.tasks)) [...t.touched, ...t.linked].forEach(f => candidates.add(f))
  const real: string[] = []
  for (const file of [...candidates].filter(isTestFile).slice(0, 200)) {
    const text = await readText($, file)
    if (text !== null && hasRealTests(text)) real.push(file)
  }
  return real.sort()
}

/**
 * Spec Kit's Claude Code integration: its core commands are there, as skills or as commands. integration.json
 * alone is not enough, and neither is a stray speckit-* skill: the autopilot has to be able to run the next step.
 */
async function hasClaudeIntegration($: $): Promise<boolean> {
  for (const name of ['plan', 'implement']) {
    if ((await exists($, `.claude/skills/speckit-${name}/SKILL.md`)) || (await exists($, `.claude/commands/speckit.${name}.md`))) return true
  }
  return false
}

function speckitVersionOf(initOptions: string | null): string | null {
  try {
    const value = JSON.parse(initOptions ?? '') as { speckit_version?: unknown }
    return typeof value.speckit_version === 'string' ? value.speckit_version : null
  } catch {
    return null
  }
}

async function refresh($: $): Promise<void> {
  const snap = await read($, snapshotA)
  const featureDir = await resolveFeature($, undefined, snap?.branch)
  if (featureDir !== (snap?.featureDir ?? null) || (await currentSignature($, featureDir)) !== signature) await scan($)
}

/** Every `@spec <id>` comment in the repository, by ripgrep or else git grep; none when neither runs. */
async function scanAnchors($: $): Promise<Anchor[] | null> {
  const runs = [
    ['rg', '-n', '--no-heading', '-o', '-e', ANCHOR_RG, '--glob', '!specs/**', '--glob', '!.specify/**', '.'],
    // --untracked: a new file the person has not committed yet holds anchors too.
    ['git', 'grep', '--untracked', '-n', '-o', '-E', ANCHOR_GIT, '--', '.', ':!specs', ':!.specify'],
  ]
  for (const argv of runs) {
    try {
      const ran = await $.process.run(argv, { cwd: root, timeoutMs: 5000 })
      if (ran.exitCode > 1) continue
      const anchors: Anchor[] = []
      for (const line of ran.stdout.split('\n')) {
        const m = /^(.+?):(\d+):(.*)$/.exec(line)
        if (!m) continue
        for (const a of anchorsIn(m[3] ?? '', relPath(m[1] ?? '', root))) anchors.push({ ...a, line: Number(m[2]) })
      }
      return anchors
    } catch {
      continue
    }
  }
  return null
}

/**
 * Writes both halves of the ledger: the committed `xref.json` (deterministic, reviewable) and the local file
 * under `.specify/xref/local/`, which a `.gitignore` of its own keeps out of commits.
 */
async function persist($: $): Promise<void> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return
  const ledger = await read($, ledgerA)
  const parts = ledgerToParts(ledger, snap.featureDir)
  try {
    if ((await readText($, `${snap.featureDir}/xref.json`)) !== parts.committed) await $.fs.write(at(`${snap.featureDir}/xref.json`), parts.committed)
    if (!(await exists($, LOCAL_IGNORE.path))) await $.fs.write(at(LOCAL_IGNORE.path), LOCAL_IGNORE.text)
    await $.fs.write(at(localPath(snap.featureDir)), parts.local)
  } catch {
    // A read-only checkout keeps the ledger for the session alone.
  }
}

/** Tells the person once the drift gets worse, never on every write. */
async function notifyLevel($: $): Promise<void> {
  const snap = await read($, snapshotA)
  if (!snap) return
  const report = evaluate(snap, await read($, ledgerA))
  if (RANK[report.level] > RANK[lastLevel] && (report.level === 'yellow' || report.level === 'red')) {
    $.ui.toast(`Spec drift ${report.level}: ${report.findings[0]?.text ?? ''}`)
  }
  lastLevel = report.level
}

async function afterWrite($: $, rel: string, c: Classified, newText: string): Promise<void> {
  if (c.verdict === 'spec') {
    await scan($)
    return
  }
  // Lockfiles, build output, caches: no evidence for a task, no drift, no part of the turn's changes.
  if (c.verdict === 'exempt') return
  const when = await stamp($)
  // A file's anchors are read again when the write may have added or removed one.
  const hadAnchors = (await read($, ledgerA)).anchors.some(a => a.file === rel)
  const text = hadAnchors || newText.includes('@spec') ? await readText($, rel) : null
  const fresh = text === null ? null : anchorsIn(text, rel)
  await update($, ledgerA, l => {
    const next = recordTouch(l, rel, c, when)
    return fresh ? { ...next, anchors: [...next.anchors.filter(a => a.file !== rel), ...fresh] } : next
  })
  // A file of a finished task is rework: it does not pull the focus back to that task.
  const task = (await read($, snapshotA))?.tasks.find(t => t.id === c.task)
  if (task && !task.done && (c.verdict === 'in-scope' || c.verdict === 'other-task')) await update($, activeA, () => task.id)
  await update($, turnFilesA, files => (files.includes(rel) ? files : [...files, rel]))
  // A test file written is read once: whether it holds real tests decides the ladder's `tested`.
  if (isTestFile(rel)) {
    const body = text ?? (await readText($, rel))
    await update($, snapshotA, s => (s ? { ...s, realTests: body && hasRealTests(body) ? [...new Set([...s.realTests, rel])].sort() : s.realTests.filter(f => f !== rel) } : s))
  }
  await notifyLevel($)
}

/**
 * The files the working tree changed, for a check the person asked for between turns: relative to the project
 * and only inside it, since the project may be one folder of a larger repository.
 */
async function changedFiles($: $): Promise<string[]> {
  const files = new Set<string>()
  for (const argv of [
    ['git', 'diff', '--name-only', '--relative', 'HEAD'],
    ['git', 'ls-files', '--others', '--exclude-standard'],
  ]) {
    try {
      const ran = await $.process.run(argv, { cwd: root, timeoutMs: 5000 })
      if (ran.exitCode === 0) for (const line of ran.stdout.split('\n')) if (line.trim()) files.add(line.trim())
    } catch {
      // No git, or no commit yet: the files of this session's turns are all there is.
    }
  }
  return [...files].filter(f => !isSpecArtifact(f)).slice(0, 40)
}

async function diffOf($: $, files: string[]): Promise<string> {
  let diff = ''
  try {
    diff = (await $.process.run(['git', 'diff', '--no-color', '--relative', '-U2', 'HEAD', '--', ...files], { cwd: root, timeoutMs: 5000 })).stdout
  } catch {
    diff = ''
  }
  // A new file is no part of `git diff`; its head stands in for it.
  for (const file of files) {
    if (diff.length > 6000 || diff.includes(`b/${file}`)) continue
    const text = await readText($, file)
    if (text !== null) diff += `\n--- new or untracked: ${file}\n${text.split('\n').slice(0, 60).join('\n')}\n`
  }
  return diff
}

/** The semantic check: one tool-less question over the session's own transcript. */
async function runCheck($: $, files: string[], model: string): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return 'No Spec Kit feature to check against.'
  if (await read($, checkingA)) return 'A drift check is already running.'
  await update($, checkingA, () => true)
  try {
    const changed = files.length ? files : await changedFiles($)
    const ledger = await read($, ledgerA)
    const active = await read($, activeA)
    const diff = await diffOf($, changed)
    let reply = await $.model.fork({ prompt: forkPrompt(snap, ledger, active, changed, diff) })
    // Before the session's first turn there is no transcript to fork; the intent log carries the user's words instead.
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
      reply = await $.model.complete({ model, prompt: forkPrompt(snap, ledger, active, changed, diff, true), maxTokens: 1000 })
    }
    if (!reply.isAnswered) return `The drift check got no answer (${reply.reason}).`
    const semantic = parseSemantic(reply.text, await stamp($))
    if (!semantic) return 'The drift check answered in a shape the mod could not read.'
    await update($, ledgerA, l => applySemantic(l, semantic))
    await persist($)
    await notifyLevel($)
    const conflict = (await read($, ledgerA)).semantic?.changes.find(c => c.kind === 'contradicts')
    if (conflict && (await read($, autopilotA)).on) await pauseAutopilot($, `your request "${conflict.text}" contradicts the spec; decide in the pane`)
    return `Intent check ${semantic.score}/100 (${semantic.verdict})${semantic.reasons[0] ? `: ${semantic.reasons[0]}` : ''}`
  } finally {
    await update($, checkingA, () => false)
  }
}

async function runMap($: $, model: string): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.spec || snap.tasks.length === 0) return 'Mapping needs a spec.md with requirements and a tasks.md.'
  const reply = await $.model.complete({ model, prompt: mapPrompt(snap.spec, snap.tasks), maxTokens: 2000 })
  if (!reply.isAnswered) return `The mapping got no answer (${reply.reason}).`
  let mapped = 0
  await update($, ledgerA, l => {
    const result = applyMapping(l, reply.text, snap)
    mapped = result.mapped
    return result.ledger
  })
  await persist($)
  const report = evaluate(snap, await read($, ledgerA))
  return `Mapped ${mapped} requirements to tasks; ${report.covered}/${report.total} FRs covered.`
}

async function toSpec($: $, intent: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (!snap) return
  await update($, ledgerA, l => resolveIntent(l, intent))
  await persist($)
  const args = `The user asked during implementation: "${intent}". Fold this into the spec, or record why it stays out of scope.`
  // The extension's revise keeps ids stable (new, SUPERSEDED, RETIRED) and logs revisions.md; clarify is the fallback.
  const revise = snap.extensions.includes('xref') && snap.commands.includes('xref-revise')
  // A plugin runs a slash command through $.command.run; a prompt may not start with one.
  const command = speckitCommand(snap, revise ? 'xref.revise' : 'clarify').slice(1)
  try {
    await $.command.run({ command, args })
  } catch {
    void $.prompt.submit({ text: `Spec Kit: ${args} Use ${speckitCommand(snap, 'clarify')} for it.` })
  }
}

async function asTask($: $, intent: string): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return 'No active feature.'
  const path = `${snap.featureDir}/tasks.md`
  const markdown = (await readText($, path)) ?? '# Tasks\n'
  const added = appendRemediation(markdown, snap.tasks, intent)
  await $.fs.write(at(path), added.markdown)
  await update($, ledgerA, l => resolveIntent(l, intent))
  await scan($)
  await persist($)
  return `Added ${added.id} to ${path}.`
}

async function focus($: $, id: string): Promise<string> {
  const snap = await read($, snapshotA)
  const task = snap?.tasks.find(t => t.id === id.trim().toUpperCase())
  if (!snap || !task) return `No task ${id} in tasks.md.`
  await update($, activeA, () => task.id)
  const reqs = reqsOf(task, await read($, ledgerA))
  return [
    `Current task: ${task.id}${task.story ? ` [${task.story}]` : ''} ${task.text}`,
    `Planned files: ${task.paths.join(', ') || '(none named)'}`,
    `Serves: ${reqs.join(', ') || '(no requirement mapped yet)'}`,
  ].join('\n')
}

async function where($: $, file: string): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return 'No active Spec Kit feature.'
  const rel = relPath(file, root)
  const ledger = await read($, ledgerA)
  const c = classify(rel, snap, ledger, await read($, activeA))
  const planned = snap.tasks.filter(t => t.paths.some(p => rel === p || rel.endsWith('/' + p) || rel.startsWith(p.replace(/\/?$/, '/'))))
  const touched = Object.entries(ledger.tasks).filter(([, e]) => e.touched.includes(rel) || e.linked.includes(rel)).map(([id]) => id)
  const reqs = Object.entries(ledger.requirements).filter(([, r]) => r.files.includes(rel)).map(([id]) => id)
  const anchors = ledger.anchors.filter(a => a.file === rel).map(a => `${a.id} (line ${a.line})`)
  return [
    `${rel} in ${snap.featureDir}: ${c.verdict}${c.task ? ` (${c.task})` : ''}`,
    `Planned by: ${planned.map(t => t.id).join(', ') || '-'}`,
    `Touched or linked by: ${touched.join(', ') || '-'}`,
    `Requirements: ${[...reqs, ...anchors].join(', ') || '-'}`,
  ].join('\n')
}

async function linkFile($: $, file: string, id: string): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return 'No active Spec Kit feature.'
  const rel = relPath(file, root)
  let error: string | undefined
  await update($, ledgerA, l => {
    const result = link(l, rel, id, snap)
    error = result.error
    return result.ledger
  })
  if (error) return error
  await persist($)
  await notifyLevel($)
  return `Linked ${rel} to ${id}.`
}

/** What the workflow reads beside the snapshot: the review option and the last test run. */
const flowOf = (ap: Autopilot): Flow => ({ review, lastTest: ap.lastTest, repairs: ap.repairs, validate: validateOn, shape: shapeOn, design: designOn, next: ap.next ?? null, nextKind: ap.nextKind ?? null })

/** Starts a fresh autopilot run; its first step follows as soon as the session is free. */
async function startAutopilot($: $, max?: number, night = false): Promise<void> {
  const cost = await sessionCost($)
  const now = await $.clock.now()
  await update($, autopilotA, a => ({ ...a, on: true, paused: null, steps: 0, stalls: 0, last: null, lastPhase: null, idea: null, max: max ?? defaultMax, repairs: 0, lastTest: null, startedAt: now, costAtStart: cost, night, scope: null, remediate: false, remediations: 0, testNote: null }))
  await update($, seenAtA, () => now)
  await retitle($)
  $.clock.after(0, () => void advance($).catch(() => undefined))
}

/** Goes on after a pause; a run whose budget is spent gets a new one. */
async function resumeAutopilot($: $): Promise<void> {
  await update($, autopilotA, a => ({ ...a, paused: null, stalls: 0, repairs: a.repairs > MAX_REPAIRS ? 0 : a.repairs, steps: a.steps >= a.max ? 0 : a.steps }))
  await retitle($)
  $.clock.after(0, () => void advance($).catch(() => undefined))
}

/** Stop: the autopilot goes off, and a turn it is running ends now rather than at its end. */
async function turnOffAutopilot($: $): Promise<void> {
  const wasOn = (await read($, autopilotA)).on
  await update($, autopilotA, a => ({ ...a, on: false, paused: null, idea: null }))
  await update($, queueA, q => ({ ...q, auto: false }))
  await retitle($)
  const turn = await read($, turnA)
  if (wasOn && turn) await $.turn.abort({ turnId: turn.id }).catch(() => undefined)
  if (wasOn) await writeBriefing($, 'stopped by you')
}

/** The session's cost so far in US dollars, or 0 where the host keeps none. */
async function sessionCost($: $): Promise<number> {
  try {
    return (await $.session.usage()).cost?.usd ?? 0
  } catch {
    return 0
  }
}

/** The pane's tab says when the autopilot waits, so it shows behind the changes pane too. */
async function retitle($: $): Promise<void> {
  try {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (!pane) return
    const ap = await read($, autopilotA)
    await $.ui.open({ id: PANE, title: ap.on && ap.paused ? `${TITLE} ⏸` : TITLE })
  } catch {
    // A host without panes has no tab to name.
  }
}

/** The requests the pane's setup actions hand to Claude, as the person's own words: a press is their consent. */
const SETUP_ASKS = {
  idea: 'I want to start something new in this empty folder (an app, a project, or a problem to solve). Ask me what it is, then set Spec Kit up for it with the speckit-xref:speckit skill (with a git repository and a first commit, so Spec Kit can open a branch per feature) and write the spec in my own words.',
  setup: 'Set Spec Kit up in this existing project with the speckit-xref:speckit skill: run specify init, draft the constitution from the code and the README and mark the assumptions, then ask me which change to specify first.',
  commit:
    "Make the first commit of this repository: first make sure a .gitignore keeps out dependencies, build output and secrets (node_modules/, dist/, .env*, and whatever this stack needs), then git add -A and commit with the message 'Initial commit'. Spec Kit can then open a branch per feature.",
  integration: "Install Spec Kit's Claude Code integration in this project (specify integration install claude), so its /speckit-* commands run here.",
} as const

async function askClaude($: $, kind: keyof typeof SETUP_ASKS): Promise<void> {
  // A press answers what the autopilot waits on: it goes on once Claude has done it.
  if ((await read($, autopilotA)).paused) await update($, autopilotA, a => ({ ...a, paused: null, stalls: 0 }))
  void $.prompt.submit({ text: SETUP_ASKS[kind], asUser: true })
}

/** Approvals only the person gives: the idea, the spec, the plan, the design, open checklists. The autopilot records checkpoints, never these. */
const APPROVALS = new Set(['idea', 'spec', 'plan', 'design', 'checklists'])
const CHECKPOINTS = new Set(['analyze', 'converge', 'verify'])

/** The person approves what the autopilot waits on (spec, plan, design, open checklists); the run goes on. */
async function approve($: $): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap) return 'Nothing to approve.'
  const ap = await read($, autopilotA)
  const ledger = await read($, ledgerA)
  const step = nextStep(snap, ledger, ap.idea, flowOf(ap))
  if (!step.approve || !APPROVALS.has(step.approve.key)) {
    // No gate stands, but the spec was never approved (◌spec): the person can approve it now, for this text.
    if (snap.spec && specReview(snap, ledger) !== 'approved') {
      await update($, ledgerA, l => ({ ...l, approvals: { ...l.approvals, spec: specFingerprint(snap.spec!) } }))
      await persist($)
      return `Approved the spec of ${snap.featureDir}.`
    }
    return 'Nothing waits for an approval.'
  }
  const { key, value } = step.approve
  if (key === 'idea') return decideIdea($, 'build')
  await update($, ledgerA, l => ({ ...l, approvals: { ...l.approvals, [key]: value } }))
  await persist($)
  if (ap.on && ap.paused) await resumeAutopilot($)
  return key === 'checklists' ? 'Going on despite the open checklist items.' : `Approved the ${key} of ${snap.featureDir}.`
}

/**
 * The person's own command for a later phase is their approval of the review that stands before it: running
 * `/speckit-plan` approves the spec, `/speckit-tasks` the plan or the design. The autopilot never runs past a review,
 * so it never approves this way; a plugin's or the model's call is no command of the person's.
 */
const COMMAND_ORDER: Record<string, number> = { plan: 1, tasks: 2, implement: 3 }
const GATE_ORDER: Record<string, number> = { spec: 1, plan: 2, design: 2, checklists: 3 }
async function approveByCommand($: $, text: string): Promise<void> {
  const m = /(?:^|\s)\/?speckit[-.](plan|tasks|implement)\b/.exec(text)
  if (!m) return
  const snap = await read($, snapshotA)
  if (!snap) return
  const ap = await read($, autopilotA)
  const step = nextStep(snap, await read($, ledgerA), ap.idea, flowOf(ap))
  const key = step.phase === 'review' ? step.approve?.key : null
  if (!key || !step.approve || !GATE_ORDER[key] || COMMAND_ORDER[m[1]!]! < GATE_ORDER[key]!) return
  const { value } = step.approve
  await update($, ledgerA, l => ({ ...l, approvals: { ...l.approvals, [key]: value } }))
  await persist($)
  $.ui.toast(`Approved the ${key}: you ran /speckit-${m[1]}.`)
}

/** Stops the autopilot until the person speaks, says why, and asks again after five minutes. */
async function pauseAutopilot($: $, reason: string, step?: Step): Promise<void> {
  await update($, autopilotA, a => ({ ...a, paused: reason }))
  $.ui.toast(`Autopilot waits for you: ${reason}`)
  await retitle($)
  $.clock.after(5 * 60_000, () => void remind($, reason).catch(() => undefined))
  // At a review the native dialog answers it in place, where a person is there to answer.
  if (step?.approve && APPROVALS.has(step.approve.key) && interactive) $.clock.after(0, () => void askApproval($, step).catch(() => undefined))
}

/** A native notification on top of the toast; switched off or without a channel, the band and the toast still say it. */
async function notify($: $, text: string): Promise<void> {
  try {
    await $.ui.notify(text, { title: TITLE })
  } catch {
    // Notifications switched off, or no channel: the band and the toast still say it.
  }
}

async function remind($: $, reason: string): Promise<void> {
  const ap = await read($, autopilotA)
  if (ap.on && ap.paused === reason) await notify($, `Autopilot waits for you: ${reason}`)
}

async function askApproval($: $, step: Step): Promise<void> {
  const key = step.approve!.key
  if (key === 'idea') {
    let answer = ''
    try {
      answer = await $.ui.ask(`${step.why} Build it?`, ['Build', 'Sharpen', 'Drop'])
    } catch {
      return
    }
    if (answer === 'Build') await decideIdea($, 'build')
    else if (answer === 'Drop') await decideIdea($, 'drop')
    else if (answer === 'Sharpen') await sharpenIdea($)
    else if (answer.trim()) void $.prompt.submit({ text: `About the idea: ${answer}`, asUser: true })
    return
  }
  const yes = key === 'checklists' ? 'Proceed anyway' : `Approve ${key}`
  const question =
    key === 'checklists' ? `${step.why} Go on implementing anyway?` : key === 'design' ? `${step.why} Approve the design for the tasks?` : `${step.why} Approve the ${key} as the contract?`
  // The terminal cannot show a mock: the browser can, and the question comes back once it is open.
  const look = 'Open the mocks'
  let answer: string
  try {
    answer = await $.ui.ask(question, key === 'design' ? [yes, look, 'Not yet'] : [yes, 'Not yet'])
  } catch {
    return
  }
  if (answer === look) {
    $.ui.toast(await openDashboard($))
    return askApproval($, step)
  }
  if (answer === yes) await approve($)
  // Anything typed under "Other" is what to change: it goes to Claude as the person's words.
  else if (answer !== 'Not yet' && answer.trim()) void $.prompt.submit({ text: answer, asUser: true })
}

async function stopAutopilot($: $, why: string): Promise<void> {
  await update($, autopilotA, a => ({ ...a, on: false, paused: null }))
  $.ui.toast(why)
  await retitle($)
  await writeBriefing($, why)
  await notify($, why)
}

/** The git HEAD, short; empty outside git. */
async function head($: $): Promise<string> {
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd: root, timeoutMs: 3000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Runs the project's tests and records what they prove: per requirement from JUnit when a report path is set,
 * else every requirement with a real test passes when the whole suite does. `ran` is false when no runner started.
 */
async function runTests($: $): Promise<{ ran: boolean; ok: boolean; output: string }> {
  const snap = await read($, snapshotA)
  if (!snap?.testCommand || !snap.featureDir) return { ran: false, ok: true, output: '' }
  let exitCode: number
  let output: string
  try {
    // CI=true: test runners run once and never wait for a key.
    const ran = await $.process.run(['sh', '-c', snap.testCommand], { cwd: root, timeoutMs: 600_000, env: { CI: 'true' } })
    exitCode = ran.exitCode
    output = `${ran.stdout}\n${ran.stderr}`.trim().slice(-4000)
  } catch {
    // No shell here, or the suite outlived ten minutes: the run goes on without a verdict.
    return { ran: false, ok: true, output: '' }
  }
  // A command that is not there is no failing test: no repair step, a note for the person instead.
  if (couldNotRun(exitCode, output)) return { ran: false, ok: true, output: `${snap.testCommand}: ${output.split('\n').filter(Boolean).at(-1) ?? `exit ${exitCode}`}` }
  const at = await stamp($)
  const commit = await head($)
  const current = Object.fromEntries((snap.spec?.reqs ?? []).map(r => [r.id, fingerprint(r.text)]))
  const ledger = await read($, ledgerA)
  const proof = { featureDir: snap.featureDir, tasks: snap.tasks, reqs: snap.spec?.reqs ?? [], realTests: snap.realTests }
  const xml = junitPath ? await readText($, junitPath) : null
  const verified = xml
    ? verificationFrom(parseJunit(xml), ledger.anchors, current, snap.featureDir, at, commit)
    : verificationFromExit(exitCode, (snap.spec?.reqs ?? []).filter(r => LADDER.indexOf(levelOf(r.id, proof, ledger)) >= LADDER.indexOf('tested')).map(r => r.id), current, at, commit)
  if (Object.keys(verified).length) {
    await update($, ledgerA, l => ({
      ...l,
      verification: { ...l.verification, ...verified },
      fingerprints: { ...l.fingerprints, ...Object.fromEntries(Object.keys(verified).filter(id => current[id]).map(id => [id, current[id]!])) },
    }))
    await persist($)
  }
  return { ran: true, ok: exitCode === 0, output }
}

/** Appends one finished step to the run log (local, never committed). */
async function logRun($: $, entry: RunEntry): Promise<void> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return
  const path = runLogPath(snap.featureDir)
  const lines = ((await readText($, path)) ?? '').split('\n').filter(Boolean).slice(-499)
  lines.push(JSON.stringify(entry))
  await $.fs.write(at(path), lines.join('\n') + '\n').catch(() => undefined)
}

async function runLog($: $): Promise<RunEntry[]> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return []
  return ((await readText($, runLogPath(snap.featureDir))) ?? '')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as RunEntry
      } catch {
        return null
      }
    })
    .filter((e): e is RunEntry => !!e)
}

/** What happened since the person last spoke: the "since you left" card and the night run's briefing. */
async function sinceYouLeft($: $): Promise<string[]> {
  const seen = await read($, seenAtA)
  const entries = (await runLog($)).filter(e => Date.parse(e.at) >= seen)
  if (!entries.length) return []
  const snap = await read($, snapshotA)
  const ap = await read($, autopilotA)
  const files = new Set(entries.flatMap(e => e.files))
  const minutes = Math.round(entries.reduce((n, e) => n + e.durationMs, 0) / 60_000)
  const lines = [`${entries.length} steps in ${minutes} min: ${[...new Set(entries.map(e => e.phase))].join(', ')}; ${files.size} files changed.`]
  if (snap) lines.push(`Tasks ${snap.tasks.filter(t => t.done).length}/${snap.tasks.length} checked${ap.lastTest ? `; tests ${ap.lastTest.ok ? 'pass' : 'fail'}` : ''}.`)
  const ledger = await read($, ledgerA)
  const open = ledger.decisions.filter(d => d.answer === null)
  if (open.length) lines.push(`Waiting for you: ${open.map(d => d.question).join(' | ')}`)
  if (ap.paused) lines.push(`Paused: ${ap.paused}`)
  return lines
}

/** A night run leaves a briefing for the morning: `.specify/xref/local/briefing.md`. */
async function writeBriefing($: $, why: string): Promise<void> {
  const ap = await read($, autopilotA)
  if (!ap.night) return
  const lines = await sinceYouLeft($)
  await $.fs.write(at('.specify/xref/local/briefing.md'), [`# Autopilot briefing (${await stamp($)})`, '', `Ended: ${why}`, '', ...lines.map(l => `- ${l}`), ''].join('\n')).catch(() => undefined)
}

/**
 * One autopilot step: the next Spec Kit step is handed to the model as a prompt of its own, unless only the
 * person can take it, the run stopped moving, or the step budget is spent.
 */
async function advance($: $): Promise<void> {
  const ap = await read($, autopilotA)
  if (!ap.on || ap.paused) return
  // One step at a time: while a turn runs, or a prompt waits for the session, the next step waits for its end.
  const queue = await read($, queueA)
  if (interactive && ((await read($, turnA)) || queue.auto || queue.person)) return
  await scan($)
  const snap = await read($, snapshotA)
  if (!snap) return
  const ledger = await read($, ledgerA)
  const step = nextStep(snap, ledger, ap.idea, flowOf(ap))
  // The step after a verification: done, or (a verify that changed the tree) verify again; either ends the run here.
  if ((step.phase === 'done' || step.phase === 'verify') && ap.lastPhase === 'verify') {
    const report = evaluate(snap, ledger)
    if (report.level === 'red') return pauseAutopilot($, 'the feature is built, but the drift is red; decide in the pane')
    const next = `Next: ${doneAsk(null).replace(/^The feature is done\. /, '')}`
    // Done means proven: with a test command, the suite has to pass once more before the run ends.
    if (snap.testCommand) {
      const tests = await runTests($)
      if (tests.ran && !tests.ok) {
        await update($, autopilotA, a => ({ ...a, lastTest: { ok: false, at: '', output: tests.output }, repairs: a.repairs + 1, lastPhase: 'repair' }))
        return advance($)
      }
      await markVerified($)
      return stopAutopilot($, `Autopilot done: every task of ${snap.featureDir} is checked, ${tests.ran ? 'the tests pass' : `the tests could not run (${snap.testCommand})`} and the drift is ${report.level}. ${next}`)
    }
    await markVerified($)
    return stopAutopilot($, `Autopilot done: every task of ${snap.featureDir} is checked and the drift is ${report.level}. No test command is known, so "done" rests on the checkboxes. ${next}`)
  }
  if (step.needsUser) return pauseAutopilot($, step.needsUser, step)
  // A repair attempt is progress of its own: the stall check must not end the three repairs early.
  const key = `${progressKey(snap, ledger)}|${ap.repairs}`
  const stalls = key === ap.last ? ap.stalls + 1 : 0
  if (stalls >= 3) return pauseAutopilot($, 'three steps without progress; look at what blocks it, then Resume')
  if (ap.steps >= ap.max) return pauseAutopilot($, `the step budget (${ap.max}) is used up; /xref auto on starts a new one`)
  const text = await handOver($, snap, ledger, step, key, stalls)
  if (text === null) return advance($)
  // Nobody is at the prompt in a -p run: the Stop hook hands the step over as its re-prompt.
  if (!interactive) {
    pendingPrompt = text
    return
  }
  await update($, queueA, q => ({ ...q, auto: true }))
  void $.prompt.submit({ text })
}

/** A finished feature that passed the done gate stays done for this tree: the next start asks what comes next. */
async function markVerified($: $): Promise<void> {
  await scan($)
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return
  const value = verifyKey(snap, snap.tasksFingerprint || tasksFingerprint(snap.tasks))
  await update($, ledgerA, l => ({ ...l, checkpoints: { ...l.checkpoints, verify: value } }))
  await persist($)
}

/**
 * Hands a step over: counts it, records its checkpoint, focuses its first task and returns the prompt that carries
 * it. Null for a step the mod carries out itself (map without the extension).
 */
async function handOver($: $, snap: Snapshot, ledger: Ledger, step: Step, key: string, stalls: number): Promise<string | null> {
  const ap = await read($, autopilotA)
  await update($, autopilotA, a => ({
    ...a,
    steps: a.steps + 1,
    last: key,
    stalls,
    lastPhase: step.phase,
    idea: step.phase === 'specify' ? null : a.idea,
    scope: step.phase === 'implement' ? snap.phase : a.scope,
    remediations: (a.remediations ?? 0) + (step.phase === 'remediate' ? 1 : 0),
    ...(step.consumes ? { next: null, nextKind: null } : {}),
  }))
  if (step.phase === 'remediate') await update($, ledgerA, l => ({ ...l, checkpoints: { ...l.checkpoints, remediate: 'done' } }))
  // Handing a step over is its checkpoint (analyze, converge); a revise takes the request it folds in off the list.
  if (step.approve) {
    const { key: point, value } = step.approve
    await update($, ledgerA, l => ({ ...l, checkpoints: { ...l.checkpoints, [point]: value } }))
  }
  if (step.resolves) await update($, ledgerA, l => resolveIntent(l, step.resolves!))
  // One phase per step: the focus starts on its first open task, wherever earlier edits left it.
  if (step.phase === 'implement' && snap.phase) {
    const first = snap.tasks.find(t => t.phase === snap.phase && !t.done)
    if (first) await update($, activeA, () => first.id)
  }
  await persist($)
  // The mod maps requirements itself where no extension command does it, then moves on.
  if (step.phase === 'map' && !snap.extensions.includes('xref')) {
    await runMap($, mapModel)
    return null
  }
  const active = await read($, activeA)
  const text = autopilotPrompt(step, ap.steps + 1, ap.max, turnContext(snap, ledger, active)) + parallelNote(snap, step)
  await update($, autopilotA, a => ({ ...a, doneAtStep: snap.tasks.filter(t => t.done).map(t => t.id) }))
  await writeDashboard($).catch(() => null)
  stepStartedAt = await $.clock.now()
  return text
}

/**
 * After a done feature the person says what comes next: a new feature, a change or a bug. The kind they pressed in
 * the pane wins; otherwise a small model tells the three apart.
 */
async function takeNext($: $, said: string): Promise<NextWork | null> {
  const ap = await read($, autopilotA)
  const kind = ap.nextKind ?? nextKindOf(await $.model.classify(said.slice(0, 1500), [...NEXT_LABELS]).catch(() => NEXT_LABELS[3]))
  if (!kind) return null
  const next: NextWork = { kind, text: said.slice(0, 1200) }
  await update($, autopilotA, a => ({ ...a, next, nextKind: null, paused: null, stalls: 0 }))
  return next
}

/** The pane's New feature, Change and Bug: the autopilot waits for the person's words on it. */
async function chooseNext($: $, kind: NextWork['kind']): Promise<void> {
  await update($, autopilotA, a => ({ ...a, nextKind: kind, next: null }))
  // Starting asks by itself: its first step is the done feature's question, now for this kind.
  if (!(await read($, autopilotA)).on) return startAutopilot($)
  await pauseAutopilot($, doneAsk(kind))
}

/** `/xref next <feature|change|bug> <words>`: what comes after a done feature, in one line. */
async function nextByCommand($: $, words: string[]): Promise<string> {
  const [first = '', ...rest] = words
  const kind = (['feature', 'change', 'bug'] as const).find(k => k === first.toLowerCase())
  const text = (kind ? rest : words).join(' ').trim()
  if (!text) return 'Say what comes next: /xref next feature|change|bug <in your own words>.'
  const snap = await read($, snapshotA)
  if (!snap) return 'No Spec Kit project here.'
  const ledger = await read($, ledgerA)
  const ap = await read($, autopilotA)
  if (nextStep(snap, ledger, ap.idea, flowOf(ap)).phase !== 'done') return 'The feature is not done yet: the autopilot finishes it first (/xref auto on).'
  if (kind) await update($, autopilotA, a => ({ ...a, nextKind: kind }))
  const next = await takeNext($, text)
  if (!next) return 'That reads as a question, not new work: /xref next feature|change|bug <words> names the kind.'
  if (!(await read($, autopilotA)).on) await startAutopilot($)
  else $.clock.after(0, () => void advance($).catch(() => undefined))
  return `Next: ${next.kind === 'feature' ? 'a new feature' : next.kind === 'change' ? 'a change' : 'a bug'}: "${next.text}". The autopilot takes it from here.`
}

const RUNNER = 'task-runner'
const RESEARCHER = 'idea-researcher'

/** The research agent's whole system prompt: evidence, no invented sources, one structured report. */
const RESEARCHER_PROMPT = [
  'You research a product idea before anyone builds it. The prompt is the idea in its author\'s words.',
  'Use WebSearch and WebFetch. Find: who has the problem and how badly (forums, reviews, articles); what already exists (apps, services, workarounds) and where each falls short; what would make this idea different; the riskiest assumption and the cheapest way to test it; signals that should stop the project.',
  'Never invent a source. Report a product or a claim as verified only with a URL you fetched; mark everything else (unverified). If a search finds nothing, say so.',
  'Answer with one report in Markdown: Problem evidence, Alternatives (name, URL or (unverified), what it does, where it falls short), Difference, Riskiest assumptions (with a cheap test each), Kill criteria, Success measures, Sources. No preamble.',
].join('\n')

/** With the parallel option, a phase's open [P] tasks go to subagents of their own, one per task. */
function parallelNote(snap: Snapshot, step: Step): string {
  if (!parallel || step.phase !== 'implement' || !snap.phase) return ''
  const ready = snap.tasks.filter(t => !t.done && t.parallel && t.phase === snap.phase)
  if (ready.length < 2) return ''
  return [
    '',
    '',
    `Parallel: ${ready.map(t => t.id).join(', ')} are marked [P] and touch different files. Spawn one ${PLUGIN}:${RUNNER} agent per task, all in one message (prompt: the task id and its line from tasks.md).`,
    'When they report back, check those tasks off in tasks.md yourself, then do the rest of the phase.',
  ].join('\n')
}

/** What a task-runner subagent is told: one task, its planned files, the xref rules, and no tasks.md. */
const RUNNER_PROMPT = [
  'You implement exactly one task of a GitHub Spec Kit feature; other agents implement its sibling tasks at the same time.',
  'Read the task line you were given, the spec.md and plan.md of the active feature (specs/<feature>/), and the files the task names.',
  `First call mcp__${PLUGIN}__focus with the task id. Change only the files the task names; if another file is unavoidable, call mcp__${PLUGIN}__link for it.`,
  'Mark code that implements a requirement with a comment `@spec <feature>/FR-###`; tests carry the anchor of what they prove.',
  'Do not edit tasks.md and do not commit: the main agent checks the task off. Run the tests that cover your files if you can.',
  'Report in three lines: what you changed (files), what the tests said, and anything left open.',
].join('\n')

/**
 * Commit per task (an option, off by default): after a step whose tests passed, the tasks it checked off are
 * committed with their files, on a feature branch only. The mod checks the staged diff itself, since git hooks
 * do not run under $.process.run.
 */
async function commitTasks($: $): Promise<string | null> {
  if (!commitPerTask) return null
  const snap = await read($, snapshotA)
  const ap = await read($, autopilotA)
  if (!snap?.featureDir || !snap.branch || /^(main|master|trunk|develop)$/.test(snap.branch)) return null
  const fresh = snap.tasks.filter(t => t.done && !(ap.doneAtStep ?? []).includes(t.id))
  if (!fresh.length) return null
  const ledger = await read($, ledgerA)
  const git = (argv: string[]) => $.process.run(['git', ...argv], { cwd: root, timeoutMs: 15_000 })
  try {
    // Never mix in what the person staged themselves.
    if ((await git(['diff', '--cached', '--name-only'])).stdout.trim()) return 'commit skipped: the index already holds staged changes'
    const files = [...new Set([...fresh.flatMap(t => ledger.tasks[t.id]?.touched ?? []), `${snap.featureDir}/tasks.md`, `${snap.featureDir}/xref.json`])]
    const present = []
    for (const f of files) if (await exists($, f)) present.push(f)
    const secret = present.find(f => /(^|\/)\.env(?!\.example$)/.test(f))
    if (secret) return `commit skipped: ${secret} looks like a secret`
    const drift = present.filter(f => ledger.unplanned.some(u => u.file === f && !u.acknowledged))
    if (drift.length) return `commit skipped: ${drift.join(', ')} ${drift.length === 1 ? 'is' : 'are'} outside the plan`
    await git(['add', '--', ...present])
    const subject = fresh.length === 1 ? `${fresh[0]!.id}: ${short(fresh[0]!.text, 60)}` : `${fresh.map(t => t.id).join(', ')} (${snap.featureDir.slice(snap.featureDir.lastIndexOf('/') + 1)})`
    const ran = await git(['commit', '-m', subject, '-m', `Tasks checked by the speckit-xref autopilot; tests passed.`])
    return ran.exitCode === 0 ? `committed ${fresh.map(t => t.id).join(', ')}` : `commit failed: ${ran.stderr.trim().slice(0, 200)}`
  } catch (error) {
    return `commit failed: ${String(error).slice(0, 200)}`
  }
}

type TurnEnd = { answer: string; reason: string; isAborted: boolean; durationMs: number; usage?: { input_tokens?: number; output_tokens?: number } }

/** After a turn: the autopilot pauses where the model or the person needs the person, and moves on otherwise. */
async function afterTurn($: $, e: TurnEnd, files: string[], wasAuto = true): Promise<void> {
  const asked = await read($, askedA)
  await update($, askedA, () => null)
  const ap = await read($, autopilotA)
  if (!ap.on) return
  // The person's own turn in the middle of a run: no step of the autopilot's, nothing to log or test.
  if (!wasAuto) {
    if (ap.paused) return
    if (asked) return pauseAutopilot($, asked)
    if (endsWithQuestion(e.answer)) {
      const label = await $.model.classify(e.answer.slice(-1500), [...QUESTION_LABELS]).catch(() => QUESTION_LABELS[0])
      if (label !== QUESTION_LABELS[1]) return pauseAutopilot($, 'the last answer asks you something')
    }
    return advance($)
  }
  if (ap.lastPhase && ap.steps > 0) {
    const snap = await read($, snapshotA)
    const outcome = e.isAborted ? 'interrupted' : e.reason !== 'answer' ? e.reason : asked ? 'asked the person' : 'answered'
    // The tasks this step checked off, else the one it was on.
    const checked = snap ? snap.tasks.filter(t => t.done && !(ap.doneAtStep ?? []).includes(t.id)).map(t => t.id) : []
    const working = ap.lastPhase === 'implement' || ap.lastPhase === 'repair' || ap.lastPhase === 'converge'
    await logRun($, {
      at: await stamp($),
      step: ap.steps,
      phase: ap.lastPhase,
      task: !working ? null : checked.length ? checked.join(', ') : snap ? (currentTask(snap, await read($, activeA))?.id ?? null) : null,
      files,
      durationMs: e.durationMs || (stepStartedAt ? (await $.clock.now()) - stepStartedAt : 0),
      tokens: (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0),
      outcome,
    })
  }
  if (ap.paused) return
  if (e.isAborted) return pauseAutopilot($, 'you interrupted the turn; Resume, or a message from you, goes on')
  // An API error or a refusal is no answer: going on would hand the next step to a turn that never did this one.
  if (e.reason !== 'answer') return pauseAutopilot($, `the turn ended with ${e.reason === 'refusal' ? 'a refusal' : 'an error'}; Resume tries again`)
  if (asked) return pauseAutopilot($, asked)
  // An analysis that found something ends by offering its fixes: the next step applies them (twice a run at most).
  const findings = ap.lastPhase === 'analyze' && (endsWithQuestion(e.answer) || /\b(CRITICAL|HIGH|MEDIUM)\b/.test(e.answer))
  if (findings && (ap.remediations ?? 0) < 2) {
    // Kept in the local ledger: a run that ends here still owes the fixes in the next session.
    await update($, ledgerA, l => ({ ...l, checkpoints: { ...l.checkpoints, remediate: 'due' } }))
    await persist($)
  } else if (endsWithQuestion(e.answer)) {
    // A question at the end is a stop only when it is a real decision; "shall I go on?" is not one.
    const label = await $.model.classify(e.answer.slice(-1500), [...QUESTION_LABELS]).catch(() => QUESTION_LABELS[0])
    if (label !== QUESTION_LABELS[1]) return pauseAutopilot($, 'the last answer asks you something')
  }
  // Code changed: the tests say whether the step holds. A failure becomes a repair step, at most three in a row.
  if (ap.lastPhase === 'implement' || ap.lastPhase === 'repair' || ap.lastPhase === 'converge') {
    const tests = await runTests($)
    if (!tests.ran && tests.output) {
      // Said once per run, where the person looks; the run goes on without a test gate.
      if (!ap.testNote) $.ui.toast(`Autopilot: the test command could not run (${tests.output.slice(0, 200)}). Set testCommand in /config.`)
      await update($, autopilotA, a => ({ ...a, testNote: tests.output.slice(0, 300) }))
    }
    if (tests.ran) {
      const when = await stamp($)
      await update($, autopilotA, a => ({ ...a, testNote: null, lastTest: { ok: tests.ok, at: when, output: tests.output }, repairs: tests.ok ? 0 : a.repairs + 1 }))
      if (tests.ok) {
        const committed = await commitTasks($)
        if (committed) $.ui.toast(`Autopilot: ${committed}`)
      }
    }
  }
  // Verify without the extension: the model checked by itself; the mod's intent check looks at the whole change too.
  const verified = await read($, snapshotA)
  if (ap.lastPhase === 'verify' && verified && !verified.extensions.includes('xref') && driftCheckOn) await runCheck($, [], mapModel).catch(() => undefined)
  const snap = await read($, snapshotA)
  if (snap && evaluate(snap, await read($, ledgerA)).level === 'red') return pauseAutopilot($, 'the drift is red; look at the findings in the pane, then Resume')
  await advance($)
}
/** The chip a booked write gets in the transcript: the task and what it serves, or why it is drift. */
function chipFor(c: Classified, snap: Snapshot, ledger: Ledger): string | null {
  if (c.verdict === 'unplanned') return '▲ unplanned'
  if (c.verdict === 'unclear') return '· unclear'
  if (c.verdict === 'spec' || c.verdict === 'exempt' || c.verdict === 'untracked') return null
  const task = snap.tasks.find(t => t.id === c.task)
  if (!task) return c.verdict === 'linked' ? '● linked' : null
  const reqs = reqsOf(task, ledger)
  return `● ${task.id}${reqs.length ? ` · ${reqs.join(' ')}` : ''}${task.done ? ' · rework' : ''}`
}

/** An autopilot prompt as one line in the transcript: `▶ auto 3/25 · implement · 4 of 8 tasks open; next T005.` */
export function compactPrompt(text: string): string | null {
  const m = /^\[speckit-xref autopilot · step (\d+\/\d+)\] (\w+): (.*)$/m.exec(text)
  return m ? `▶ auto ${m[1]} · ${m[2]} · ${m[3]}` : null
}

/** What this run cost so far and how long it took: ` · $1.80 · 23m`. */
/** The band's word on tasks.md's phases: `P3/7 · ` while one is open. */
function bandPhase(snap: Snapshot): string {
  const { phases, current } = taskPhases(snap.tasks)
  return phases.length > 1 && current >= 0 ? `P${phaseNumber(phases[current]!.title, current)} · ` : ''
}

/** The pane's Phase row: which of tasks.md's phases runs, how far it is, and the ones around it (`✓1 ✓2 ▶3 ·4`). */
function phaseRow<T>(snap: Snapshot, row: (label: string, text: string, color?: Color) => T): T | null {
  const { phases, current } = taskPhases(snap.tasks)
  if (phases.length < 2) return null
  const n = (i: number) => phaseNumber(phases[i]!.title, i)
  const strip = phases.map((p, i) => (p.done === p.total ? `✓${n(i)}` : i === current ? `▶${n(i)}` : `·${n(i)}`)).join(' ')
  if (current < 0) return row('Phase', `${strip} · every phase is done`, 'success')
  const p = phases[current]!
  // Numbers first: on a narrow pane the row cuts its end, and the title is the part that can go.
  return row('Phase', `${n(current)} · ${p.done}/${p.total} · ${strip} · ${phaseLabel(p.title)}`)
}

/**
 * What this run used so far and how long it took. On a subscription the usage windows are what limits it
 * (` · 5h 34% · 7d 12% · 23m`); `$` is /cost's list-price estimate, what an API key is billed (` · $1.80 · 23m`).
 */
async function runCost($: $, ap: Autopilot): Promise<string> {
  if (!ap.startedAt) return ''
  const minutes = Math.max(0, Math.round(((await $.clock.now()) - ap.startedAt) / 60_000))
  let windows: { kind: string; percentUsed: number }[] = []
  try {
    windows = (await $.session.usage()).rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
  } catch {
    windows = []
  }
  if (windows.length) {
    const label = (kind: string) => (kind === 'five_hour' ? '5h' : '7d')
    return ` · ${windows.map(w => `${label(w.kind)} ${Math.round(w.percentUsed)}%`).join(' · ')} · ${minutes}m`
  }
  const usd = Math.max(0, (await sessionCost($)) - ap.costAtStart)
  return ` · $${usd.toFixed(2)} · ${minutes}m`
}

/** Accepts one edit outside the plan as intended. */
async function acceptOne($: $, file: string): Promise<void> {
  await update($, ledgerA, l => ({ ...l, unplanned: l.unplanned.map(u => (u.file === file ? { ...u, acknowledged: true } : u)) }))
  await persist($)
  lastLevel = 'none'
}

/** Accept all asks first: a blind accept is the one way drift tracking quietly stops meaning anything. */
async function confirmAcceptAll($: $): Promise<void> {
  const snap = await read($, snapshotA)
  const open = snap ? openUnplanned(snap, await read($, ledgerA)).length : 0
  let answer = ''
  try {
    answer = await $.ui.ask(`Accept all ${open} edits outside the plan as intended?`, ['Accept all', 'Cancel'])
  } catch {
    return
  }
  if (answer !== 'Accept all') return
  await update($, ledgerA, acknowledgeAll)
  await persist($)
  lastLevel = 'none'
}

/** The git blob hash of each file, to tell a file Bash changed during a turn from one that was dirty before. */
async function hashFiles($: $, files: string[]): Promise<Record<string, string>> {
  if (!files.length) return {}
  try {
    const ran = await $.process.run(['git', 'hash-object', '--', ...files], { cwd: root, timeoutMs: 5000 })
    if (ran.exitCode !== 0) return {}
    const hashes = ran.stdout.split('\n').filter(Boolean)
    return Object.fromEntries(files.map((f, i) => [f, hashes[i] ?? '']))
  } catch {
    return {}
  }
}

/**
 * Books what Bash wrote (sed, a code generator, npm): files the working tree changed during the turn that no
 * Write or Edit booked. Without this the live view and the CI check would disagree.
 */
async function bookShellWrites($: $): Promise<void> {
  const turn = await read($, turnA)
  const snap = await read($, snapshotA)
  if (!turn || !snap?.featureDir) return
  const booked = new Set(await read($, turnFilesA))
  const before = new Map(turn.dirty.map(entry => [entry.slice(0, entry.lastIndexOf(':')), entry.slice(entry.lastIndexOf(':') + 1)]))
  const now = (await changedFiles($)).filter(f => !booked.has(f) && !matchesAny(f, snap.rules.exempt))
  const hashes = await hashFiles($, now.filter(f => before.has(f)))
  // A file dirty before the turn counts only when its content provably changed.
  const fresh = now.filter(f => !before.has(f) || (hashes[f] && before.get(f) && hashes[f] !== before.get(f))).slice(0, 40)
  for (const rel of fresh) {
    const text = (await readText($, rel)) ?? ''
    const c = classify(rel, await read($, snapshotA) ?? snap, await read($, ledgerA), currentTask(snap, await read($, activeA))?.id ?? null, text)
    await afterWrite($, rel, c, text)
  }
}

/**
 * The ask tool: where a person is there, the native dialog answers in the same turn and the run goes on. A question
 * that blocks only some stories becomes a decision in the queue, and the rest of the work goes on; otherwise the
 * autopilot waits once the turn ends.
 */
async function ask($: $, input: Record<string, unknown>): Promise<string> {
  const question = str(input.question) || 'a decision only you can make'
  const options = Array.isArray(input.options) ? input.options.filter((o): o is string => typeof o === 'string').slice(0, 4) : []
  const blocks = Array.isArray(input.blocks) ? input.blocks.filter((b): b is string => typeof b === 'string') : []
  const allow = str(input.allow).trim()
  const ap = await read($, autopilotA)
  // A question for an action the rails stopped: the person's yes allows exactly that action, once, for ten minutes.
  if (allow && interactive) {
    const yes = `Yes, allow ${allow} once`
    try {
      const answer = await $.ui.ask(question.endsWith('?') ? question : `${question}?`, [yes, 'No'])
      await recordDecision($, question, [yes, 'No'], blocks, answer || 'No', 'permission')
      if (answer === yes) {
        const until = (await $.clock.now()) + 10 * 60_000
        await update($, permitsA, ps => [...ps.filter(p => p.label !== allow), { label: allow, until }])
        return `The person allowed ${allow} once: run it now.`
      }
      return `The person said no: leave ${allow} to them, and say so in your answer.`
    } catch {
      // Dismissed, or nobody there to ask: the question waits for the end of the turn.
    }
  }
  if (interactive && !allow) {
    try {
      const answer = await $.ui.ask(question.endsWith('?') ? question : `${question}?`, options.length >= 2 ? options : ['Decide it yourself, record it as an assumption', 'Stop and wait for me'])
      if (answer && answer !== 'Stop and wait for me') {
        await recordDecision($, question, options, blocks, answer)
        return `The person answered: ${answer}. Go on with it${ap.on ? '; the autopilot keeps running' : ''}.`
      }
    } catch {
      // Dismissed, or nobody there to ask: the question waits for the end of the turn.
    }
  }
  if (ap.on && blocks.length) {
    await recordDecision($, question, options, blocks, null)
    return `Recorded for the person: "${question}". Leave ${blocks.join(', ')} alone and go on with the work that does not depend on it.`
  }
  await update($, askedA, () => question)
  return ap.on ? 'The autopilot will wait for the person. Put the question in your answer and end your turn.' : 'Noted. Put the question in your answer.'
}

async function recordDecision($: $, question: string, options: string[], blocks: string[], answer: string | null, kind?: 'permission'): Promise<void> {
  const when = await stamp($)
  const decision = { id: '', question, options, blocks, at: when, answer, ...(kind ? { kind } : {}) }
  await update($, ledgerA, l => ({ ...l, decisions: [...l.decisions, { ...decision, id: `D${l.decisions.length + 1}` }].slice(-50) }))
  await persist($)
}

/** The person answers a queued decision in the pane: Claude reads it on the next step. */
async function answerDecision($: $, id: string, answer: string): Promise<void> {
  await update($, ledgerA, l => ({ ...l, decisions: l.decisions.map(d => (d.id === id ? { ...d, answer } : d)) }))
  await persist($)
  const d = (await read($, ledgerA)).decisions.find(x => x.id === id)
  if (d) void $.prompt.submit({ text: `Decision ${d.id} (${d.question}): ${answer}. Apply it to ${d.blocks.join(', ') || 'the work it blocked'}.`, asUser: true })
}

async function statusText($: $): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap) return 'Spec X-Ref has not read this project yet.'
  const ledger = await read($, ledgerA)
  const next = nextStep(snap, ledger)
  if (!snap.featureDir) return [next.why, next.needsUser ?? (next.command ? `Next: ${next.command}` : '')].filter(Boolean).join(' ')
  // The host already names the plugin in front of a command's answer.
  return (turnContext(snap, ledger, await read($, activeA), stepLine(next)) ?? '').replace(/^speckit-xref · /, '')
}

/** The workflow state for the model: where the project stands in Spec Kit and what comes next. */
async function workflowStatus($: $): Promise<string> {
  await scan($)
  const snap = await read($, snapshotA)
  if (!snap) return 'Spec X-Ref has not read this project yet.'
  const ledger = await read($, ledgerA)
  const next = nextStep(snap, ledger)
  const report = evaluate(snap, ledger)
  const ap = await read($, autopilotA)
  const lines = [
    `Project root: ${root} (every path below is relative to it)`,
    `Spec Kit CLI: ${snap.tools.specify ? 'specify is installed' : snap.tools.uvx ? 'not installed; runs through uvx' : 'missing, and no uvx either'}`,
    `Spec Kit: ${snap.initialized ? `set up${snap.speckitVersion ? ` (${snap.speckitVersion})` : ''}` : 'not set up'}${snap.initialized ? ` · Claude Code integration ${snap.claudeIntegration ? `yes, commands as ${speckitCommand(snap, 'plan')}` : 'missing'}` : ''} · extensions: ${snap.extensions.join(', ') || 'none'}`,
    `Autopilot: ${ap.on ? (ap.paused ? `on, waiting: ${ap.paused}` : `on, step ${ap.steps}/${ap.max}`) : 'off (/xref auto on)'}`,
    ...(snap.initialized ? [] : [`Folder: ${snap.folder === 'empty' ? 'empty (only dotfiles, README, license)' : 'existing code'}`]),
    `Constitution: ${snap.constitution?.principles.length ? `${snap.constitution.principles.length} principles, ${snap.constitution.musts.length} MUST rules` : 'missing or still the template'}`,
    `Active feature: ${snap.featureDir ? `${snap.featureDir}${snap.spec ? ` (${snap.spec.title})` : ''}` : 'none'}`,
  ]
  if (snap.features.length > 1) lines.push(`All features: ${snap.features.join(', ')} (switch by writing {"feature_directory": "<dir>"} to .specify/feature.json)`)
  if (snap.featureDir && snap.spec) {
    const state = specReview(snap, ledger)
    lines.push(
      `Spec review: ${state === 'approved' ? 'approved by the person' : state === 'changed' ? 'the spec changed since the person approved it' : review === 'none' ? 'off (review: none)' : 'not approved by the person (do not say it is)'}`,
    )
  }
  if (snap.featureDir && snap.ui) {
    const d = snap.design
    lines.push(
      `Design: ${!d || d.screens === null ? `not drawn yet (${screensPath(snap.featureDir)} is missing)` : `${d.system ? DESIGN_FILE : 'no DESIGN.md'}, ${d.screens.length} screens${ledger.approvals.design === d.fingerprint ? ', approved by the person' : review.includes('design') ? ', not approved by the person (do not say it is)' : ''}`}`,
    )
  }
  if (snap.featureDir) {
    lines.push(`Artifacts: spec.md ${snap.spec ? 'yes' : 'no'} · plan.md ${snap.hasPlan ? 'yes' : 'no'} · tasks.md ${snap.tasks.length ? `${report.done}/${report.tasks} done` : 'no'} · FR covered ${report.covered}/${report.total} · drift ${report.level}`)
  }
  if (snap.featureDir) lines.push(`Test command: ${snap.testCommand ?? 'none known (the testCommand option, a test script in package.json, or plan.md\'s Testing line names one)'}`)
  lines.push(`Phase: ${next.phase}. ${next.why}`, `Next: ${next.command ?? next.needsUser ?? ''}`)
  if (next.needsUser) lines.push(`Needs the person: ${next.needsUser}`)
  if (next.notes.length) lines.push('Notes:', ...next.notes.map(n => `- ${n}`))
  return lines.join('\n')
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** The answer of one of the mod's own tools when its hook failed. */
function failed() {
  return { result: 'speckit-xref could not answer this call; claude --debug has the reason.' }
}

/** A failed write guard: in strict mode it refuses rather than letting an unchecked edit through. */
function guardFailed<E, R>($: $, e: E, next: ((e: E) => R) & { readonly called: boolean }): R | { deny: string } {
  if (strict && !next.called) return { deny: 'speckit-xref (strict) could not check this edit against the plan; try again, or switch strict mode off.' }
  return next(e)
}

/** What the autopilot never does unattended: these wait for the person (docs: D6, tighten-only). */
const DESTRUCTIVE: [RegExp, string][] = [
  [/\bgit\s+push\b/, 'pushing'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'git clean -f'],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/, 'discarding every change'],
  [/\bgit\s+branch\s+-D\b/, 'deleting a branch'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, 'rm -rf'],
  [/\b(?:drop|truncate)\s+(?:table|database)\b/i, 'dropping data'],
]

/** Why the autopilot may not run this call on its own, or null. */
export function railFor(tool: string, input: Record<string, unknown>): string | null {
  return railHit(tool, input)?.reason ?? null
}

/** The rail a call runs into: its label (what a permit names) and why. */
export function railHit(tool: string, input: Record<string, unknown>): { label: string; reason: string } | null {
  if (tool === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    const hit = DESTRUCTIVE.find(([re]) => re.test(command))
    return hit ? { label: hit[1], reason: `${hit[1]} is the person's call` } : null
  }
  if (WRITE_TOOLS.has(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? '')
    const name = file.slice(file.lastIndexOf('/') + 1)
    return /^\.env(?!\.example$)/.test(name) ? { label: `writing ${name}`, reason: `writing ${name} (secrets) is the person's call` } : null
  }
  return null
}

/** allowPush: a plain push of a feature branch after green tests; never main, never forced, never a deletion. */
export function pushAllowed(command: string, branch: string | null, testsOk: boolean): boolean {
  if (!branch || /^(main|master|trunk)$/.test(branch) || !testsOk) return false
  if (/\s(-f|--force(?:-with-lease)?|--delete|-d|--mirror|--all|--tags)\b/.test(command)) return false
  return !/\b(main|master|trunk)\b|\s:\S/.test(command.replace(/^.*?\bgit\s+push\b/, ''))
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Partial<Options>
  const mode = opts.mode === 'strict' ? 'strict' : 'advisory'
  strict = mode === 'strict'
  junitPath = typeof opts.junitPath === 'string' ? opts.junitPath.trim() : ''
  review = REVIEWS.find(r => r === opts.review) ?? 'spec+design'
  parallel = opts.parallel === 'on'
  commitPerTask = opts.commitPerTask === 'on'
  paneMode = opts.pane === 'always' || opts.pane === 'off' ? opts.pane : 'auto'
  const driftCheck = opts.driftCheck === 'off' ? 'off' : 'fork'
  driftCheckOn = driftCheck === 'fork'
  validateOn = opts.validate !== 'off'
  shapeOn = opts.shape !== 'off'
  designOn = opts.design !== 'off'
  allowPush = opts.allowPush === 'on'
  mapModel = opts.mapModel || 'haiku'
  testCommandOption = typeof opts.testCommand === 'string' ? opts.testCommand.trim() : ''
  const autopilotByDefault = opts.autopilot === 'on'
  const maxSteps = typeof opts.autopilotMaxSteps === 'number' && opts.autopilotMaxSteps > 0 ? Math.floor(opts.autopilotMaxSteps) : 25
  defaultMax = maxSteps

  on('session.start', async ($, e, next) => {
    root = await projectRoot($, e.cwd || (await $.session.cwd()))
    interactive = e.isInteractive !== false
    lastLevel = 'none'
    await update($, turnFilesA, () => [])
    await update($, askedA, () => null)
    await update($, turnA, () => null)
    await update($, seenAtA, () => 0)
    cli = { specify: await onPath($, 'specify'), uvx: await onPath($, 'uvx') }
    // SPECKIT_XREF_AUTOPILOT=on|night|<steps> switches it on for this session: the way into a -p run, where /xref auto on starts no model turn.
    const fromEnv = ((await $.env.get('SPECKIT_XREF_AUTOPILOT')) ?? '').trim().toLowerCase()
    const envSteps = Number(fromEnv) > 0 ? Math.floor(Number(fromEnv)) : null
    if (autopilotByDefault || fromEnv === 'on' || fromEnv === 'night' || envSteps) {
      const night = fromEnv === 'night'
      const max = envSteps ?? (night ? Math.max(maxSteps, 100) : maxSteps)
      await update($, autopilotA, a => (a.on ? a : { ...a, on: true, max, night, startedAt: Date.now() }))
    }
    await scan($)
    const commands = [
      { name: COMMAND, description: 'Spec X-Ref: status, or check | map | ack | approve | focus T### | auto on|night|off | next feature|change|bug <words> | pane | web', argumentHint: '[check | map | ack | approve | focus T### | auto on [steps]|night|off | next feature|change|bug <words> | pane | web]' },
      // Runs mid-turn: the one way to stop the autopilot while its step is still working.
      { name: STOP_COMMAND, description: 'Spec X-Ref: stop the autopilot now, the running turn included', immediate: true as const },
    ]
    for (const command of commands) {
      try {
        await $.command.register(command)
      } catch {
        // A host that lists no plugin commands still gets the band and the pane.
      }
    }
    const tools = [
      {
        name: 'focus',
        description: 'Spec Kit: make a task from tasks.md the current one before working on it. Returns its planned files and the requirements it serves.',
        inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'Task id, e.g. T004' } }, required: ['task'] },
      },
      {
        name: 'where',
        description: 'Spec Kit: which tasks and requirements a file belongs to (planned, touched, linked, @spec anchors).',
        inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Path of the file' } }, required: ['file'] },
      },
      {
        name: 'status',
        description: 'Spec Kit: where this project stands in the Spec Kit workflow (set up, constitution, active feature, plan, tasks, coverage, drift) and the command that comes next. Call it before suggesting a Spec Kit step.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'ask',
        description: 'Spec Kit autopilot: call this when, and only when, the work needs a decision only the person can make (the product idea, a [NEEDS CLARIFICATION] question, a conflict between their request and the spec, anything destructive or irreversible, credentials). It asks the person at once where it can and returns their answer; otherwise the autopilot waits for it. Never call it to ask whether to continue.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question for the person, in one or two sentences, ending in a question mark' },
            options: { type: 'array', items: { type: 'string' }, description: 'Two to four answers to choose from (optional)' },
            blocks: { type: 'array', items: { type: 'string' }, description: 'The user stories (US2) or tasks (T007) that cannot go on without the answer (optional); other work goes on' },
            allow: { type: 'string', description: 'For an action the autopilot stopped as the person\'s call: its label exactly as the refusal names it (e.g. "pushing"). The person then answers yes or no, and a yes allows that action once.' },
          },
          required: ['question'],
        },
      },
      {
        name: 'link',
        description: 'Spec Kit: tie a file to a task (T###) or a requirement (FR-### / SC-###, optionally <feature>/FR-###), so an edit outside the planned files is no longer drift.',
        inputSchema: {
          type: 'object',
          properties: { file: { type: 'string', description: 'Path of the file' }, id: { type: 'string', description: 'T004, FR-002 or 001-feature/FR-002' } },
          required: ['file', 'id'],
        },
      },
    ]
    // Outside a Spec Kit project the tools wait behind ToolSearch and nothing polls: they cost that session nothing.
    const initialized = !!(await read($, snapshotA))?.initialized
    for (const tool of tools) {
      try {
        await $.tool.register({ ...tool, isDeferred: !initialized })
      } catch {
        // Without the tools the model still reads the section and the notes.
      }
    }
    timer?.cancel()
    timer = initialized ? $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined)) : null
    // pane: always opens it with the session in every Spec Kit project. The engine seats an unasked pane from 144
    // columns (110 once the person has opened it); narrower, it waits, and the band's Pane button opens it.
    if (paneMode === 'always' && initialized && !offered) {
      offered = true
      void $.ui.open({ id: PANE, title: TITLE })
    }
    // Validate hands the web research to an agent of its own, so the main conversation stays lean. Only offered
    // where Validate can still come: a new project before its first feature.
    const fresh = await read($, snapshotA)
    if (validateOn && fresh?.folder === 'empty' && fresh.features.length === 0) {
      try {
        await $.agent.register({ name: RESEARCHER, description: 'Researches a product idea on the web before it becomes a spec: who has the problem, what exists, what differs, the riskiest assumption.', prompt: RESEARCHER_PROMPT, tools: ['WebSearch', 'WebFetch', 'Read'] })
      } catch {
        // Without it the validate skill researches in the main loop.
      }
    }
    if (parallel) {
      try {
        await $.agent.register({ name: RUNNER, description: 'Implements one Spec Kit task of a phase while sibling [P] tasks run in other agents; never edits tasks.md.', prompt: RUNNER_PROMPT })
      } catch {
        // Without the agent type the phase runs in the main loop, one task after another.
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // Whose turn this is: the autopilot's step, or a message of the person's. Either leaves the queue.
    const auto = e.text.includes('[speckit-xref autopilot')
    await update($, turnA, () => ({ id: e.turnId, startedAt: 0, dirty: [], auto }))
    await update($, queueA, q => (auto ? { ...q, auto: false } : { ...q, person: false }))
    if (!root || !(await read($, snapshotA))?.featureDir) return result
    // What the working tree looked like before: a file that changes during the turn without a Write or Edit came from Bash.
    const dirty = await changedFiles($)
    const hashes = await hashFiles($, dirty)
    await update($, turnA, t => (t && t.id === e.turnId ? { ...t, dirty: dirty.map(f => `${f}:${hashes[f] ?? ''}`) } : t))
    return result
  })

  // The stable part: the spec and the rules. It changes only with the spec, so the prompt cache holds.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const snap = await read($, snapshotA)
    const text = snap ? composeSection(snap, mode, PLUGIN) : null
    if (!text) return composed
    const id = `${PLUGIN}:spec`
    return { ...composed, sections: [...composed.sections.filter(s => s.id !== id), { id, text, scope: 'session' as const }] }
  })

  // The person's own words are the intent; each prompt is logged and carries the current task and drift.
  on('prompt.submit', async ($, e, next) => {
    const snap = await read($, snapshotA)
    // An engine that names no origin (a test's own submission) speaks for the person.
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    if (origin !== undefined && !PERSON.has(origin)) return next(e)
    const ap = await read($, autopilotA)
    const said = e.text.trim()
    await update($, seenAtA, () => Date.now())
    // Typed while a turn runs, the message waits for the session: the autopilot's next step waits behind it.
    if (await read($, turnA)) await update($, queueA, q => ({ ...q, person: true }))
    await approveByCommand($, said)
    const waiting = snap && ap.on ? nextStep(snap, await read($, ledgerA), ap.idea, flowOf(ap)) : null
    // The person's word ends a pause. It is the idea to specify only where the autopilot waits for exactly that.
    if (ap.on && (ap.paused || waiting)) {
      const idea = waiting && takesIdea(waiting, snap!) && said && !said.startsWith('/') ? said.slice(0, 600) : ap.idea
      await update($, autopilotA, a => ({ ...a, paused: null, stalls: 0, idea }))
    }
    // A -p run starts on the person's prompt: that turn is the first step, handed over and logged like any other.
    if (!interactive && ap.on && ap.steps === 0 && waiting && !waiting.needsUser && snap?.featureDir) {
      const ledger = await read($, ledgerA)
      const text = await handOver($, snap, ledger, waiting, `${progressKey(snap, ledger)}|${ap.repairs}`, 0)
      if (text) return next({ ...e, context: [...(e.context ?? []), text] })
    }
    // At a done feature the words are what comes next: the autopilot hands over its step once this turn ends.
    // A question or a remark stays a conversation.
    const work = ap.on && waiting?.phase === 'done' && said && !said.startsWith('/') ? await takeNext($, said) : null
    if (work) {
      const what = work.kind === 'feature' ? `a new feature (${speckitCommand(snap!, 'specify')} next)` : work.kind === 'change' ? 'a change to the finished feature (the spec first)' : 'a bug to reproduce and fix'
      const note = `speckit-xref · the autopilot takes these words as ${what} and hands that step over when this turn ends. Do not start on it in this turn: answer in one sentence.`
      return next({ ...e, context: [...(e.context ?? []), note] })
    }
    if (!snap?.featureDir) {
      // Quiet unasked: before Spec Kit is there, a prompt carries a note only while the autopilot is on.
      return next(waiting ? { ...e, context: [...(e.context ?? []), setupNote(waiting, snap!)] } : e)
    }
    const text = e.text.trim()
    const active = await read($, activeA)
    if (text && !text.startsWith('/')) {
      const when = await stamp($)
      await update($, ledgerA, l => logIntent(l, text, currentTask(snap, active)?.id ?? null, when))
    }
    const ledger = await read($, ledgerA)
    const note = turnContext(snap, ledger, active, stepLine(nextStep(snap, ledger, ap.idea, flowOf(ap))))
    const notes = [note, ap.on ? AUTONOMY_RULES.join('\n') : null].filter((n): n is string => !!n)
    return next(notes.length ? { ...e, context: [...(e.context ?? []), ...notes] } : e)
  }).catch(($, e, next) => next(e))

  // Every write is booked against a task; one outside the plan is drift, refused in strict mode.
  on('tool.call', async ($, e, next) => {
    if (!WRITE_TOOLS.has(String(e.tool)) || !root) return next(e)
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown; content?: unknown; new_string?: unknown }
    const file = str(input.file_path) || str(input.notebook_path)
    const snap = await read($, snapshotA)
    if (!file || !snap?.featureDir) return next(e)
    const rel = relPath(file, root)
    // The current task is the one in focus, else the first open one: what the person and the model were shown.
    const current = currentTask(snap, await read($, activeA))?.id ?? null
    const newText = str(input.content) || str(input.new_string)
    const c = classify(rel, snap, await read($, ledgerA), current, newText)
    if (mode === 'strict' && c.verdict === 'unplanned') {
      return {
        deny: `speckit-xref (strict): ${rel} is not planned for ${current ?? 'any task'}. Call mcp__${PLUGIN}__focus with the task this edit serves, mcp__${PLUGIN}__link to tie the file to a task or requirement, or ask the user to extend the spec (${speckitCommand(snap, 'clarify')}).`,
      }
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    await afterWrite($, rel, c, newText)
    const chip = chipFor(c, snap, await read($, ledgerA))
    const id = str((e as unknown as { tool_use_id?: unknown }).tool_use_id)
    if (chip && id) await update($, chipsA, chips => Object.fromEntries([...Object.entries(chips), [id, chip]].slice(-200)))
    const note = editNote(rel, c, snap, current, PLUGIN)
    return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
  }).catch(guardFailed)

  on('tool.call', { tool: 'mcp__speckit-xref__ask' }, async ($, e) => ({ result: await ask($, e as unknown as Record<string, unknown>) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__status' }, async $ => ({ result: await workflowStatus($) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__focus' }, async ($, e) => ({ result: await focus($, str((e as unknown as { task?: unknown }).task)) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__where' }, async ($, e) => ({ result: await where($, str((e as unknown as { file?: unknown }).file)) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__link' }, async ($, e) => {
    const input = e as unknown as { file?: unknown; id?: unknown }
    return { result: await linkFile($, str(input.file), str(input.id)) }
  }).catch(failed)

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !root) return result
    await bookShellWrites($)
    const files = await read($, turnFilesA)
    const turn = await read($, turnA)
    // A turn the engine raised no turn.start for (a test's) counts as the autopilot's, as before 0.4.1.
    const wasAuto = turn ? turn.auto : true
    await update($, turnFilesA, () => [])
    await update($, turnA, () => null)
    await refresh($)
    await persist($)
    await writeDashboard($).catch(() => null)
    const snap = await read($, snapshotA)
    if (snap?.initialized && !timer) timer = $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
    // In a -p run with the autopilot on, the Stop hook already did all of this before the turn ended.
    if (!interactive && (await read($, autopilotA)).on) return result
    const check = files.length > 0 && driftCheck === 'fork' && !e.isAborted
    const end: TurnEnd = { answer: e.answer ?? '', reason: e.reason, isAborted: e.isAborted, durationMs: e.durationMs, usage: e.usage as TurnEnd['usage'] }
    // After the turn, on the clock, so the person gets the prompt back at once; the check first, so the
    // autopilot never hands over a step before a contradiction it found could stop it.
    $.clock.after(0, () =>
      void (async () => {
        if (check) await runCheck($, files, mapModel).catch(() => undefined)
        await afterTurn($, end, files, wasAuto)
      })().catch(() => undefined),
    )
    return result
  })

  // The headless driver: in a -p run nobody submits the next prompt, so the Stop hook re-prompts with it.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (interactive || result.block || !root) return result
    const ap = await read($, autopilotA)
    if (!ap.on || ap.paused) return result
    if (!pendingPrompt) {
      await bookShellWrites($)
      const files = await read($, turnFilesA)
      await update($, turnFilesA, () => [])
      await refresh($)
      await persist($)
      if (files.length && driftCheck === 'fork') await runCheck($, files, mapModel).catch(() => undefined)
      await afterTurn($, { answer: e.last_assistant_message ?? '', reason: 'answer', isAborted: false, durationMs: 0 }, files)
    }
    const prompt = pendingPrompt
    pendingPrompt = null
    return prompt ? { ...result, block: prompt } : result
  })

  // Commands layout (`/speckit.implement`): the same state rides the expansion as context.
  on('classic.UserPromptExpansion', async ($, e, next) => {
    const result = await next(e)
    if (!/^speckit\.(implement|clarify|plan|tasks|analyze|converge)$/.test(e.command_name)) return result
    const snap = await read($, snapshotA)
    if (!snap?.featureDir) return result
    const note = turnContext(snap, await read($, ledgerA), await read($, activeA))
    return note ? { ...result, additionalContext: [...(result.additionalContext ?? []), note] } : result
  })

  // The person running a Spec Kit command by itself (`/speckit-plan`) approves the review before it.
  on('command.run', async ($, e, next) => {
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    if (origin === undefined || PERSON.has(origin)) await approveByCommand($, `/${e.command}`).catch(() => undefined)
    return next(e)
  })

  // A stop that cannot wait for the turn: the autopilot goes off and its running step ends now.
  on('command.run', { command: STOP_COMMAND }, async $ => {
    const ap = await read($, autopilotA)
    if (!ap.on) return { text: 'The autopilot is off.' }
    await turnOffAutopilot($)
    return { text: 'Autopilot off; its running step was stopped.' }
  })

  // Guard rails while the autopilot runs: they only ever tighten what the engine decided.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const ap = await read($, autopilotA)
    if (!ap.on) return verdict
    if (verdict.decision === 'deny') return verdict
    const input = (e.input ?? {}) as Record<string, unknown>
    const hit = railHit(e.tool, input)
    if (hit) {
      const snap = await read($, snapshotA)
      if (hit.label === 'pushing' && allowPush && pushAllowed(str(input.command), snap?.branch ?? null, ap.lastTest?.ok !== false)) return verdict
      const now = await $.clock.now()
      const permit = (await read($, permitsA)).find(p => p.label === hit.label && p.until > now)
      if (permit) {
        await update($, permitsA, ps => ps.filter(p => !(p.label === permit.label && p.until === permit.until)))
        return verdict
      }
      return { decision: 'deny' as const, reason: `speckit-xref autopilot: ${hit.reason}. Ask the person with mcp__${PLUGIN}__ask, passing allow: "${hit.label}"; their yes allows it once.` }
    }
    // A permission prompt in a run nobody watches would hold it silently: say so where the person will see it.
    if (verdict.decision === 'ask' && e.tool_use_id) $.clock.after(0, () => void notify($, `Autopilot waits on a permission prompt for ${e.tool}.`))
    return verdict
  })

  // Spec Kit's own commands get the ledger's view: the current task, its files, coverage and drift.
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    if (!/^speckit-(implement|clarify|plan|tasks|analyze|converge)$/.test(e.skill)) return result
    const snap = await read($, snapshotA)
    if (!snap?.featureDir) return result
    const ledger = await read($, ledgerA)
    const note = turnContext(snap, ledger, await read($, activeA))
    return note ? { text: `${result.text}\n\n## speckit-xref: where this feature stands\n\n${note}` } : result
  })

  // What a compacted conversation must keep: the task in focus, the person's open requests, the decisions, the run.
  on('session.compact', async ($, e, next) => {
    const snap = await read($, snapshotA)
    if (!snap?.featureDir || e.agentId) return next(e)
    const ledger = await read($, ledgerA)
    const ap = await read($, autopilotA)
    const task = currentTask(snap, await read($, activeA))
    const keep = [
      `Keep for speckit-xref: the active feature ${snap.featureDir}${task ? ` and the current task ${task.id} (${task.text})` : ''}.`,
      ...ledger.intents.filter(i => i.status === 'extends' || i.status === 'contradicts').slice(-5).map(i => `Keep the person's request verbatim: "${i.text}" (${i.status} the spec).`),
      ...ledger.decisions.slice(-5).map(d => `Keep the decision: ${d.question} → ${d.answer ?? 'open'}.`),
      ...(ap.on ? [`The autopilot is on (step ${ap.steps}/${ap.max}${ap.paused ? `, waiting: ${ap.paused}` : ''}).`] : []),
    ].join('\n')
    return next({ ...e, instructions: [e.instructions, keep].filter(Boolean).join('\n\n') })
  })

  on('command.run', { command: 'xref' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    switch (verb.toLowerCase()) {
      case 'check':
        return { text: await runCheck($, [], mapModel) }
      case 'map':
        return { text: await runMap($, mapModel) }
      case 'ack':
        await update($, ledgerA, acknowledgeAll)
        await persist($)
        lastLevel = 'none'
        return { text: 'Accepted every edit outside the plan.' }
      case 'focus':
        return { text: await focus($, rest[0] ?? '') }
      case 'approve':
        return { text: await approve($) }
      case 'web':
        return { text: await openDashboard($) }
      case 'next':
        return { text: await nextByCommand($, rest) }
      case 'auto': {
        const [mode = '', budget = ''] = rest
        if (mode === 'off') {
          await turnOffAutopilot($)
          return { text: 'Autopilot off.' }
        }
        if (mode === 'on') {
          const max = Number(budget) > 0 ? Math.floor(Number(budget)) : maxSteps
          // The first step starts once this command is done; each later one when a turn ends.
          await startAutopilot($, max)
          return { text: `Autopilot on: it works through Spec Kit by itself for up to ${max} steps and stops only for decisions that are yours. /xref auto off stops it; so does Esc.` }
        }
        if (mode === 'night') {
          const max = Number(budget) > 0 ? Math.floor(Number(budget)) : Math.max(maxSteps, 100)
          await startAutopilot($, max, true)
          return { text: `Night run on: up to ${max} steps; reviews and real decisions still wait for you. When it stops, .specify/xref/local/briefing.md says what happened, and the pane shows it under "Since you left".` }
        }
        const ap = await read($, autopilotA)
        return { text: ap.on ? (ap.paused ? `Autopilot on, waiting for you: ${ap.paused}` : `Autopilot on, step ${ap.steps}/${ap.max}.`) : 'Autopilot off. /xref auto on [steps] starts it.' }
      }
      case 'pane': {
        // Look first, so the pane opens on where things stand. No keyboard: the next key must not press a button.
        await scan($)
        const opened = await $.ui.open({ id: PANE, title: TITLE })
        const here = await statusText($)
        if (!opened.isPlaced) return { text: `The pane is open but waits: ${opened.reason}\n${here}` }
        const pane = (await $.ui.panes()).find(p => p.id === PANE)
        if (pane && !pane.isShown) return { text: `The pane is open behind another tab of the dock: switch to its tab "${TITLE}".\n${here}` }
        return { text: `Spec X-Ref pane open. Click its buttons, or ctrl+x tab to give it the keyboard.\n${here}` }
      }
      default:
        await refresh($)
        return { text: await statusText($) }
    }
  })

  // Transcript chips: each booked write says which task it served, and the autopilot's long prompts fold to one line.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!WRITE_TOOLS.has(e.props.tool)) return next(e)
    const chip = (await read($, chipsA))[e.props.tool_use_id]
    const theirs = await next(e)
    if (!chip || !theirs) return theirs
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {theirs}
        <Text dimColor color={chip.startsWith('▲') ? 'warning' : undefined}>{`  ${chip}`}</Text>
      </Box>
    )
  })
  // The documented way to fold a row. Claude Code 2.1.296's terminal still draws a plugin's own prompt framed and in
  // full (checked live): the fold shows where a surface honours the rewrite.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const line = e.props.isExpanded ? null : compactPrompt(e.props.text)
    return next(line ? { ...e, props: { ...e.props, text: line } } : e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshotA)
    const ap = await read($, autopilotA)
    // The pane opens unasked only where it is a sidebar (fullscreen), never as a takeover of the main screen.
    if (!offered && paneMode !== 'off' && snap?.featureDir && e.viewport?.isFullscreen === true) {
      offered = true
      void $.ui.open({ id: PANE, title: TITLE })
    }
    if ((!snap?.featureDir && !ap.on) || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const ledger = await read($, ledgerA)
    const report = snap?.featureDir ? evaluate(snap, ledger) : null
    const task = snap ? currentTask(snap, await read($, activeA)) : null
    const checking = await read($, checkingA)
    const run = ap.on && !ap.paused ? await runCost($, ap) : ''
    const auto = ap.on ? (ap.paused ? ' · auto ⏸ waiting for you' : ` · auto ▶ ${ap.steps}/${ap.max}${run}`) : ''
    const state = STATE[report?.level ?? 'none']
    // One click to the pane while it is not on screen: closed, behind another tab, or waiting for a wider terminal.
    const pane = paneMode === 'off' ? undefined : (await $.ui.panes().catch(() => [])).find(p => p.id === PANE)
    const paneHidden = paneMode !== 'off' && !(pane?.isShown && pane.isPlaced !== false)
    const line = (
      <Box key="speckit-xref-band" flexDirection="row">
        <Text color={LEVEL_COLOR[report?.level ?? 'none']}>{state.glyph} </Text>
        <Text bold>xref </Text>
        <Text wrap="truncate-end">
          {report
            ? `${task ? `${task.id} · ` : ''}${bandPhase(snap!)}tasks ${report.done}/${report.tasks} · FR ${report.covered}/${report.total} · ${state.word}${report.findings.length ? ` (${report.findings.length})` : ''}`
            : snap
              ? nextStep(snap, ledger, ap.idea, flowOf(ap)).phase
              : ''}
          {checking ? ' · checking…' : ''}
        </Text>
        <Text color={ap.paused ? 'warning' : 'suggestion'}>{auto}</Text>
        {paneHidden && !ap.paused ? (
          <Box marginLeft={1}>
            <Button key="band-open-pane" label="Pane" onPress={() => void $.ui.open({ id: PANE, title: TITLE })} />
          </Box>
        ) : null}
      </Box>
    )
    // Waiting for the person is the one state that must not be missed: the whole question, and the way on.
    const waitingOn = ap.on && ap.paused && snap ? nextStep(snap, ledger, ap.idea, flowOf(ap)).approve : undefined
    const approval = waitingOn && APPROVALS.has(waitingOn.key) ? waitingOn.key : null
    const mine = ap.on && ap.paused ? (
      <Box key="speckit-xref-band" flexDirection="column">
        {line}
        <Box flexDirection="row" columnGap={1}>
          <Text color="warning" wrap="wrap">
            {`⏸ ${ap.paused}`}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {approval ? (
            <Button key="band-approve" label={approval === 'checklists' ? 'Proceed anyway' : approval === 'idea' ? 'Build' : `Approve ${approval}`} variant="primary" onPress={() => void approve($).then(text => $.ui.toast(text))} />
          ) : (
            <Button key="band-resume" label="Resume" variant="primary" onPress={() => void resumeAutopilot($)} />
          )}
          <Button key="band-stop" label="Stop" onPress={() => void turnOffAutopilot($)} />
          <Button key="band-pane" label="Pane" onPress={() => void $.ui.open({ id: PANE, title: `${TITLE} ⏸` })} />
        </Box>
      </Box>
    ) : (
      line
    )
    const theirs = await next(e)
    return theirs ? (
      <Box flexDirection="column">
        {mine}
        {theirs}
      </Box>
    ) : (
      mine
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Every surface but mobile has a Select; there the cards keep their buttons alone.
    const Select = 'Select' in elements ? elements.Select : null
    const snap = await read($, snapshotA)
    const ledger = await read($, ledgerA)
    const ap = await read($, autopilotA)
    const autoLabel = ap.on ? (ap.paused ? `on · waiting for you: ${ap.paused}` : `on · step ${ap.steps}/${ap.max}${await runCost($, ap)}`) : 'off'
    // The autopilot's switch sits with its state: Start while off, Stop while on, Resume while it waits.
    const autoRow = (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box width={8}>
            <Text bold color="claude">
              Auto
            </Text>
          </Box>
          <Text wrap="truncate-end" color={ap.paused ? 'warning' : ap.on ? 'suggestion' : 'subtle'}>
            {autoLabel}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={1} marginLeft={8}>
          {!ap.on ? <Button key="auto" label="Start autopilot" hotkey="p" variant="primary" onPress={() => void startAutopilot($)} /> : null}
          {ap.on && ap.paused ? <Button key="auto-resume" label="Resume" hotkey="r" variant="primary" onPress={() => void resumeAutopilot($)} /> : null}
          {ap.on ? <Button key="auto-stop" label="Stop" hotkey="p" onPress={() => void turnOffAutopilot($)} /> : null}
        </Box>
      </Box>
    )
    const setupAction = (step: ReturnType<typeof nextStep>, snapshot: Snapshot) =>
      step.phase === 'setup' && step.command ? (
        snapshot.folder === 'empty' ? (
          <Button key="setup-idea" label="Start from an idea" variant="primary" onPress={() => void askClaude($, 'idea')} />
        ) : (
          <Button key="setup-here" label="Set up Spec Kit here" variant="primary" onPress={() => void askClaude($, 'setup')} />
        )
      ) : step.phase === 'integration' ? (
        <Button key="setup-integration" label="Add Claude integration" variant="primary" onPress={() => void askClaude($, 'integration')} />
      ) : step.phase === 'setup' && snapshot.commits === false ? (
        <Button key="setup-commit" label="First commit" variant="primary" onPress={() => void askClaude($, 'commit')} />
      ) : null
    if (!snap?.featureDir || !snap.spec) {
      const next = snap ? nextStep(snap, ledger, ap.idea, flowOf(ap)) : null
      const action = next && snap ? setupAction(next, snap) : null
      const brief = snap?.ideaBrief
      const decided = brief && snap?.ideaDecision?.fingerprint === brief.fingerprint ? snap.ideaDecision.decision : null
      const ideaCard = brief ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`Idea: ${brief.title}`}</Text>
          {brief.oneLiner ? <Text>{brief.oneLiner}</Text> : null}
          <Text dimColor>{`Score ${brief.score ?? '–'}/5 · recommends ${brief.recommendation ?? '–'} · ${brief.research ? 'researched on the web' : 'no web research'}`}</Text>
          {brief.alternatives.slice(0, 4).map(a => (
            <Text dimColor wrap="truncate-end">{`${a.verified ? '✓' : '?'} ${a.name}${a.note ? ` · ${a.note}` : ''}`}</Text>
          ))}
          {brief.risks[0] ? <Text color="warning" wrap="truncate-end">{`Riskiest: ${brief.risks[0]}`}</Text> : null}
          {brief.kill[0] ? <Text dimColor wrap="truncate-end">{`Stop if: ${brief.kill[0]}`}</Text> : null}
          <Box flexDirection="row" columnGap={1} marginTop={1}>
            {decided === 'drop' ? <Button key="idea-reopen" label="Reopen" onPress={() => void reopenIdea($, false).then(text => $.ui.toast(text))} /> : null}
            {decided === 'drop' ? <Button key="idea-new" label="New idea" onPress={() => void reopenIdea($, true).then(text => $.ui.toast(text))} /> : null}
            {decided === 'build' ? <Text color="success">● You decided: build</Text> : null}
            {!decided ? <Button key="idea-build" label="Build" variant="primary" onPress={() => void decideIdea($, 'build').then(text => $.ui.toast(text))} /> : null}
            {!decided ? <Button key="idea-sharpen" label="Sharpen" onPress={() => void sharpenIdea($)} /> : null}
            {!decided ? <Button key="idea-drop" label="Drop" onPress={() => void decideIdea($, 'drop').then(text => $.ui.toast(text))} /> : null}
          </Box>
        </Box>
      ) : null
      return (
        <Box flexDirection="column">
          <Text bold>{next?.why ?? 'No Spec Kit feature found.'}</Text>
          {snap?.initialized === false ? <Text dimColor>{`Folder: ${root}`}</Text> : null}
          <Text dimColor>{next?.needsUser ?? (next?.command ? `Next: ${next.command}` : 'Ask Claude to set up Spec Kit here (skill speckit-xref:speckit).')}</Text>
          {action ? (
            <Box flexDirection="row" marginTop={1}>
              {action}
            </Box>
          ) : null}
          {ideaCard}
          {/* The autopilot shows here only while it runs; it is started where there is a workflow to run. */}
          {ap.on ? <Box marginTop={1}>{autoRow}</Box> : null}
        </Box>
      )
    }
    const report: Report = evaluate(snap, ledger)
    const task = currentTask(snap, await read($, activeA))
    const checking = await read($, checkingA)
    const spec = snap.spec
    const step = nextStep(snap, ledger, ap.idea, flowOf(ap))
    const width = Math.max(10, e.props.bodyColumns - 8)
    const narrow = e.props.bodyColumns < 70
    const details = !narrow || (await read($, detailsA))
    const state = STATE[report.level]
    const bar = (done: number, total: number, size: number) => {
      const filled = total ? Math.round((done / total) * size) : 0
      return '█'.repeat(filled) + '░'.repeat(size - filled)
    }
    const row = (label: string, text: string, color?: Color) => (
      <Box flexDirection="row">
        <Box width={8}>
          <Text bold color="claude">
            {label}
          </Text>
        </Box>
        <Text wrap="truncate-end" color={color}>
          {text.slice(0, width * 2)}
        </Text>
      </Box>
    )
    const open = snap.tasks.filter(t => !t.done && t.id !== task?.id)
    const reqs = task ? reqsOf(task, ledger) : []
    const intents = report.findings.filter(f => f.kind === 'intent' && f.intent)
    const unplanned = openUnplanned(snap, ledger).slice(-5)
    const others = report.findings.filter(f => f.kind !== 'intent' && f.kind !== 'unplanned')
    const ladder = `spec ${report.levels.specified} · plan ${report.levels.planned} · impl ${report.levels.implemented} · test ${report.levels.tested} · pass ${report.levels.passing}`
    const linkOptions = [...snap.tasks.filter(t => !t.done), ...snap.tasks.filter(t => t.done)].map(t => ({ value: t.id, label: `${t.id} ${short(t.text, 40)}` }))
    const away = ap.steps > 0 ? await sinceYouLeft($) : []
    const decisions = ledger.decisions.filter(d => d.answer === null).slice(-3)
    const reviewCard =
      step.phase === 'review' && step.approve ? (
        <Box flexDirection="column" marginTop={1}>
          {row(
            'Review',
            step.approve.key === 'plan'
              ? 'plan.md is written: read it, then approve it as the plan.'
              : step.approve.key === 'design'
                ? 'The look is drafted: open the mocks, then approve it for the tasks.'
                : 'Is this what you meant? Approve it as the contract.',
            'warning',
          )}
          {/* The way on first: on a short pane the card's details may run past the bottom. */}
          <Box flexDirection="row" columnGap={1} marginLeft={8}>
            <Button key="approve" label={`Approve ${step.approve.key}`} variant="primary" onPress={() => void approve($).then(text => $.ui.toast(text))} />
            {step.approve.key === 'design' ? <Button key="mocks" label="Open the mocks" onPress={() => void openDashboard($).then(text => $.ui.toast(text))} /> : null}
          </Box>
          {step.approve.key === 'design'
            ? (snap.design?.screens ?? []).slice(0, 8).map(sc => row('', `${sc.name}${sc.serves.length ? ` · ${sc.serves.join(' ')}` : ''}${sc.mock ? '' : ' · no mock'}`))
            : null}
          {step.approve.key === 'spec' ? row('', `You said: "${short((spec.input ?? '-').replace(/\s+/g, ' '), width * 2)}"`, 'subtle') : null}
          {step.approve.key === 'spec' ? spec.reqs.filter(r => r.kind === 'FR' && r.status === 'active').slice(0, 8).map(r => row('', `${r.id} ${r.text}`)) : null}
          {step.approve.key === 'spec' && spec.outOfScope.length ? row('', `Out of scope: ${spec.outOfScope.join(' · ')}`, 'subtle') : null}
          {step.approve.key === 'spec' ? spec.assumptions.map(a => row('', `Assumed: ${a}`, 'warning')) : null}
        </Box>
      ) : step.phase === 'checklists' && step.approve ? (
        <Box flexDirection="row" columnGap={1} marginLeft={8}>
          <Button key="approve" label="Proceed anyway" onPress={() => void approve($).then(text => $.ui.toast(text))} />
        </Box>
      ) : null
    // A done feature: what comes next is the person's, and the pane offers the three ways on.
    const doneCard =
      step.phase === 'done' ? (
        <Box flexDirection="column" marginTop={1}>
          {row('Done', ap.nextKind ? doneAsk(ap.nextKind) : 'Every task is checked, converged and verified. What comes next?', 'success')}
          <Box flexDirection="row" columnGap={1} marginLeft={8}>
            <Button key="next-feature" label="New feature" variant="primary" onPress={() => void chooseNext($, 'feature')} />
            <Button key="next-change" label="Change" onPress={() => void chooseNext($, 'change')} />
            <Button key="next-bug" label="Bug" onPress={() => void chooseNext($, 'bug')} />
          </Box>
        </Box>
      ) : null
    const driftCards = (
      <Box flexDirection="column">
        {unplanned.map((u, i) => (
          <Box flexDirection="column">
            {row('', `▲ ${u.file} is not planned for any task`, 'warning')}
            <Box flexDirection="row" columnGap={1} marginLeft={8}>
              {linkOptions.length && Select ? (
                <Select
                  key={`link-${i}`}
                  label="Link to "
                  options={linkOptions}
                  value={u.task ?? task?.id ?? linkOptions[0]!.value}
                  onSelect={(value: string) => void linkFile($, u.file, value).then(text => $.ui.toast(text))}
                />
              ) : null}
              <Button key={`accept-${i}`} label="Accept this" onPress={() => void acceptOne($, u.file)} />
            </Box>
          </Box>
        ))}
        {others.slice(0, 5).map(f => row('', `${f.level === 'red' ? '✖' : '▲'} ${f.text}`, f.level === 'red' ? 'error' : 'warning'))}
        {intents.slice(0, 3).map((f, i) => (
          <Box flexDirection="column">
            {row('', `${f.level === 'red' ? '✖' : '▲'} ${f.text}`, f.level === 'red' ? 'error' : 'warning')}
            <Box flexDirection="row" columnGap={1} marginLeft={8}>
              <Button key={`spec-${i}`} label="To spec" onPress={() => void toSpec($, f.intent ?? '')} />
              <Button key={`task-${i}`} label="As task" onPress={() => void asTask($, f.intent ?? '').then(text => $.ui.toast(text))} />
            </Box>
          </Box>
        ))}
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {spec.title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {phaseStrip(snap, step, review !== 'none' && specReview(snap, ledger) !== 'approved')}
        </Text>
        {step.phase !== 'review' && review !== 'none' && specReview(snap, ledger) !== 'approved' ? (
          <Box flexDirection="row" columnGap={1}>
            {row('Spec', specReview(snap, ledger) === 'changed' ? 'changed since you approved it' : 'not approved by you yet', 'warning')}
            <Button key="approve-spec" label="Approve spec" onPress={() => void approve($).then(text => $.ui.toast(text))} />
          </Box>
        ) : null}
        {snap.commits === false ? (
          <Box flexDirection="row" columnGap={1}>
            {row('Git', 'no commit yet: no branch per feature', 'warning')}
            <Button key="setup-commit" label="First commit" onPress={() => void askClaude($, 'commit')} />
          </Box>
        ) : null}
        {details ? row('Goal', spec.input ?? (spec.stories.map(s => s.title).join(' · ') || '-')) : null}
        {details ? row('Vision', snap.constitution?.principles.length ? snap.constitution.principles.join(' · ') : 'no constitution yet') : null}
        {row('Now', task ? `${task.id}${task.story ? ` [${task.story}]` : ''} ${task.text}` : snap.tasks.length ? 'every task is checked' : 'no tasks.md yet', 'warning')}
        {details && task && (task.paths.length || reqs.length) ? row('', [task.paths.join(', '), reqs.join(' ')].filter(Boolean).join(' · '), 'subtle') : null}
        {details ? row('Todo', open.length ? open.slice(0, 3).map(t => t.id).join(' · ') + (open.length > 3 ? ` · +${open.length - 3}` : '') : '-') : null}
        {row('Status', `${bar(report.done, report.tasks, 10)} ${report.done}/${report.tasks} tasks · FR ${report.covered}/${report.total}`)}
        {phaseRow(snap, row)}
        {details && snap.design?.screens?.length && step.approve?.key !== 'design' ? (
          <Box flexDirection="row" columnGap={1}>
            {row(
              'Design',
              `${snap.design.system ? DESIGN_FILE : 'no DESIGN.md'} · ${snap.design.screens.length} screens · ${
                ledger.approvals.design === snap.design.fingerprint ? 'approved by you' : ledger.approvals.design ? 'changed since you approved it' : 'not reviewed'
              }`,
              'subtle',
            )}
            <Button key="design-mocks" label="Mocks" onPress={() => void openDashboard($).then(text => $.ui.toast(text))} />
          </Box>
        ) : null}
        {details ? row('Proof', ladder, 'subtle') : null}
        {row('Next', stepLine(step), 'suggestion')}
        {step.phase === 'integration' ? <Box marginLeft={8}>{setupAction(step, snap)}</Box> : null}
        {reviewCard}
        {doneCard}
        {away.length ? (
          <Box flexDirection="column" marginTop={1}>
            {row('Away', away[0]!, 'claude')}
            {away.slice(1).map(l => row('', l, 'subtle'))}
          </Box>
        ) : null}
        {decisions.map((d, i) =>
          d.options.length >= 2 && Select ? (
            <Box flexDirection="row" columnGap={1}>
              {row(i ? '' : 'Decide', `${d.id} ${d.question}`, 'warning')}
              <Select key={`decide-${d.id}`} options={d.options.map(o => ({ value: o, label: o }))} onSelect={(value: string) => void answerDecision($, d.id, value)} />
            </Box>
          ) : (
            row(i ? '' : 'Decide', `${d.id} ${d.question} (answer in the prompt)`, 'warning')
          ),
        )}
        {autoRow}
        {ap.lastTest && !ap.lastTest.ok ? row('Tests', `fail · ${short(failureLine(ap.lastTest.output), width)}`, 'error') : null}
        {ap.testNote ? row('Tests', `could not run · ${short(ap.testNote, width)} · set testCommand in /config`, 'warning') : null}
        {row('Drift', `${state.glyph} ${state.word}${ledger.semantic ? ` · intent ${ledger.semantic.score}/100` : ''}${checking ? ' · checking…' : ''}`, LEVEL_COLOR[report.level])}
        {details ? driftCards : report.findings.length ? row('', `${report.findings.length} findings · d shows them`, 'subtle') : null}
        {details ? report.notes.map(n => row('', `· ${n}`, 'subtle')) : null}
        {details && report.uncovered.length ? row('', `no task yet: ${report.uncovered.join(' ')}`, 'subtle') : null}
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Button key="check" label="Check now" hotkey="c" onPress={() => void runCheck($, [], mapModel).then(text => $.ui.toast(text))} />
          {unplanned.length ? <Button key="ack" label="Accept all" onPress={() => void confirmAcceptAll($)} /> : null}
          {report.uncovered.length && snap.tasks.length ? <Button key="map" label="Map FR→tasks" hotkey="m" onPress={() => void runMap($, mapModel).then(text => $.ui.toast(text))} /> : null}
          {narrow ? <Button key="details" label={details ? 'Less' : 'Details'} hotkey="d" onPress={() => void update($, detailsA, d => !d)} /> : null}
        </Box>
      </Box>
    )
  })
}
