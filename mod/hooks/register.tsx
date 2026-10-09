import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Ledger, Snapshot } from '../types'
import { parseConstitution, parseFeatureJson, parseSpec, parseTasks } from './speckit'
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
  forkPrompt,
  ledgerFromJson,
  ledgerToJson,
  link,
  logIntent,
  mapPrompt,
  parseSemantic,
  recordTouch,
  relPath,
  reqsOf,
  resolveIntent,
  speckitCommand,
  turnContext,
} from './xref'
import type { Anchor } from '../types'
import type { Classified, Level, Report } from './xref'

type $ = EngineInterface
type Options = { mode: string; driftCheck: string; mapModel: string }

const PLUGIN = 'speckit-xref'
const PANE = 'speckit-xref'
const TITLE = 'Spec X-Ref'
const COMMAND = 'xref'
const REFRESH_MS = 4000
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
// Prompts the person typed, wherever they typed them; a plugin's or a peer's are not their intent.
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const LEVEL_COLOR = { none: 'subtle', green: 'success', yellow: 'warning', red: 'error' } as const
const RANK: Record<Level, number> = { none: 0, green: 1, yellow: 2, red: 3 }
const ANCHOR_RG = '@spec\\s+(?:[\\w.-]+/)?(?:FR|SC|T)-?\\d{3,}'
const ANCHOR_GIT = '@spec[[:space:]]+([[:alnum:]_.-]+/)?(FR|SC|T)-?[0-9]{3,}'

const snapshotA = atom({ plugin: 'speckit-xref', key: 'snapshot' } as const, null)
const ledgerA = atom({ plugin: 'speckit-xref', key: 'ledger' } as const, emptyLedger())
const activeA = atom({ plugin: 'speckit-xref', key: 'active' } as const, null)
const checkingA = atom({ plugin: 'speckit-xref', key: 'checking' } as const, false)

// The module's own: they start over on a reload, and session.start fills them again.
let root = ''
let signature = ''
let offered = false
let lastLevel: Level = 'none'
let turnFiles: string[] = []
let timer: { cancel: () => void } | null = null

const at = (rel: string) => (rel.startsWith('/') ? rel : `${root}/${rel}`)
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

/** The active feature: SPECIFY_FEATURE_DIRECTORY, .specify/feature.json, SPECIFY_FEATURE, else the spec written last. */
async function resolveFeature($: $): Promise<string | null> {
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
  let best: string | null = null
  let bestTime = 0
  for (const dir of ['specs', '.specify/specs']) {
    let entries
    try {
      entries = await $.fs.list(at(dir))
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.kind !== 'dir') continue
      const rel = `${dir}/${entry.name}`
      const time = Math.max(await mtime($, `${rel}/tasks.md`), await mtime($, `${rel}/spec.md`))
      if (time > bestTime) {
        best = rel
        bestTime = time
      }
    }
  }
  return best
}

async function currentSignature($: $, featureDir: string | null): Promise<string> {
  const files = ['.specify/feature.json', '.specify/memory/constitution.md']
  if (featureDir) files.push(`${featureDir}/spec.md`, `${featureDir}/tasks.md`)
  const times = await Promise.all(files.map(f => mtime($, f)))
  return [featureDir ?? '-', ...times].join('|')
}

/** Reads Spec Kit's files into the snapshot; a new feature brings its own ledger. */
async function scan($: $): Promise<void> {
  const featureDir = await resolveFeature($)
  const [specMd, tasksMd, constitutionMd] = await Promise.all([
    featureDir ? readText($, `${featureDir}/spec.md`) : null,
    featureDir ? readText($, `${featureDir}/tasks.md`) : null,
    readText($, '.specify/memory/constitution.md'),
  ])
  const commandsOnly = (await exists($, '.claude/commands/speckit.clarify.md')) && !(await exists($, '.claude/skills/speckit-clarify/SKILL.md'))
  const snapshot: Snapshot = {
    featureDir,
    spec: specMd ? parseSpec(specMd) : null,
    tasks: tasksMd ? parseTasks(tasksMd) : [],
    constitution: constitutionMd ? parseConstitution(constitutionMd) : null,
    commandStyle: commandsOnly ? 'commands' : 'skills',
  }
  const previous = await read($, snapshotA)
  if (!previous || previous.featureDir !== featureDir) {
    const ledger = featureDir ? ledgerFromJson(await readText($, `${featureDir}/xref.json`)) : emptyLedger()
    const anchors = featureDir ? await scanAnchors($) : null
    await update($, ledgerA, () => (anchors ? { ...ledger, anchors } : ledger))
    await update($, activeA, () => null)
  }
  await update($, snapshotA, () => snapshot)
  signature = await currentSignature($, featureDir)
}

async function refresh($: $): Promise<void> {
  const snap = await read($, snapshotA)
  const featureDir = await resolveFeature($)
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

async function persist($: $): Promise<void> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return
  const ledger = await read($, ledgerA)
  try {
    await $.fs.write(at(`${snap.featureDir}/xref.json`), ledgerToJson(ledger, snap.featureDir, await stamp($), evaluate(snap, ledger)))
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
  const when = await stamp($)
  // A file's anchors are read again when the write may have added or removed one.
  const hadAnchors = (await read($, ledgerA)).anchors.some(a => a.file === rel)
  const text = hadAnchors || newText.includes('@spec') ? await readText($, rel) : null
  const fresh = text === null ? null : anchorsIn(text, rel)
  await update($, ledgerA, l => {
    const next = recordTouch(l, rel, c, when)
    return fresh ? { ...next, anchors: [...next.anchors.filter(a => a.file !== rel), ...fresh] } : next
  })
  if (c.task && (c.verdict === 'in-scope' || c.verdict === 'other-task')) await update($, activeA, () => c.task)
  if (!turnFiles.includes(rel)) turnFiles.push(rel)
  await notifyLevel($)
}

/** The files the working tree changed, for a check the person asked for between turns. */
async function changedFiles($: $): Promise<string[]> {
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: root, timeoutMs: 5000 })
    return ran.stdout
      .split('\n')
      .map(l => l.slice(3).trim().replace(/^"|"$/g, ''))
      .filter(f => f && !/^(specs|\.specify|\.claude)\//.test(f))
      .slice(0, 40)
  } catch {
    return []
  }
}

async function diffOf($: $, files: string[]): Promise<string> {
  let diff = ''
  try {
    diff = (await $.process.run(['git', 'diff', '--no-color', '-U2', 'HEAD', '--', ...files], { cwd: root, timeoutMs: 5000 })).stdout
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
  // A plugin runs a slash command through $.command.run; a prompt may not start with one.
  const command = speckitCommand(snap, 'clarify').slice(1)
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

async function statusText($: $): Promise<string> {
  const snap = await read($, snapshotA)
  if (!snap?.featureDir) return 'No Spec Kit feature found (specs/NNN-*/spec.md). Start one with /speckit-specify.'
  // The host already names the plugin in front of a command's answer.
  return (turnContext(snap, await read($, ledgerA), await read($, activeA)) ?? '').replace(/^speckit-xref · /, '')
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** The answer of one of the mod's own tools when its hook failed. */
function failed() {
  return { result: 'speckit-xref could not answer this call; claude --debug has the reason.' }
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Partial<Options>
  const mode = opts.mode === 'strict' ? 'strict' : 'advisory'
  const driftCheck = opts.driftCheck === 'off' ? 'off' : 'fork'
  const mapModel = opts.mapModel || 'haiku'

  on('session.start', async ($, e, next) => {
    root = e.cwd || (await $.session.cwd())
    lastLevel = 'none'
    turnFiles = []
    await scan($)
    for (const command of [{ name: COMMAND, description: 'Spec X-Ref: status, or check | map | ack | focus T### | pane', argumentHint: '[check | map | ack | focus T### | pane]' }]) {
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
        name: 'link',
        description: 'Spec Kit: tie a file to a task (T###) or a requirement (FR-### / SC-###, optionally <feature>/FR-###), so an edit outside the planned files is no longer drift.',
        inputSchema: {
          type: 'object',
          properties: { file: { type: 'string', description: 'Path of the file' }, id: { type: 'string', description: 'T004, FR-002 or 001-feature/FR-002' } },
          required: ['file', 'id'],
        },
      },
    ]
    for (const tool of tools) {
      try {
        await $.tool.register({ ...tool, isDeferred: false })
      } catch {
        // Without the tools the model still reads the section and the notes.
      }
    }
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
    const snap = await read($, snapshotA)
    const surfaces = await $.session.surfaces()
    if (!offered && snap?.featureDir && (surfaces.includes('terminal') || surfaces.includes('desktop'))) {
      offered = true
      void $.ui.open({ id: PANE, title: TITLE })
    }
    return next(e)
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
    if (!snap?.featureDir || (origin !== undefined && !PERSON.has(origin))) return next(e)
    const text = e.text.trim()
    const active = await read($, activeA)
    if (text && !text.startsWith('/')) {
      const when = await stamp($)
      await update($, ledgerA, l => logIntent(l, text, currentTask(snap, active)?.id ?? null, when))
    }
    const note = turnContext(snap, await read($, ledgerA), active)
    return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
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
    const note = editNote(rel, c, snap, current, PLUGIN)
    return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__speckit-xref__focus' }, async ($, e) => ({ result: await focus($, str((e as unknown as { task?: unknown }).task)) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__where' }, async ($, e) => ({ result: await where($, str((e as unknown as { file?: unknown }).file)) })).catch(failed)
  on('tool.call', { tool: 'mcp__speckit-xref__link' }, async ($, e) => {
    const input = e as unknown as { file?: unknown; id?: unknown }
    return { result: await linkFile($, str(input.file), str(input.id)) }
  }).catch(failed)

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !root) return result
    const files = turnFiles
    turnFiles = []
    await refresh($)
    await persist($)
    // The check runs after the turn, on the clock, so the person gets the prompt back at once.
    if (files.length && driftCheck === 'fork' && !e.isAborted) $.clock.after(0, () => void runCheck($, files, mapModel).catch(() => undefined))
    return result
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
      case 'pane':
        await $.ui.open({ id: PANE, title: TITLE })
        return { text: 'Spec X-Ref pane opened.' }
      default:
        await refresh($)
        return { text: await statusText($) }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshotA)
    if (!snap?.featureDir || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const report = evaluate(snap, await read($, ledgerA))
    const task = currentTask(snap, await read($, activeA))
    const checking = await read($, checkingA)
    const mine = (
      <Box key="speckit-xref-band" flexDirection="row">
        <Text color={LEVEL_COLOR[report.level]}>● </Text>
        <Text bold>xref </Text>
        <Text wrap="truncate-end">
          {task ? `${task.id} · ` : ''}tasks {report.done}/{report.tasks} · FR {report.covered}/{report.total} · drift {report.level}
          {report.findings.length ? ` (${report.findings.length})` : ''}
          {checking ? ' · checking…' : ''}
        </Text>
      </Box>
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshotA)
    if (!snap?.featureDir || !snap.spec) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No Spec Kit feature found.</Text>
          <Text dimColor>Start one with /speckit-specify; this pane follows specs/NNN-*/.</Text>
        </Box>
      )
    }
    const ledger = await read($, ledgerA)
    const report: Report = evaluate(snap, ledger)
    const task = currentTask(snap, await read($, activeA))
    const checking = await read($, checkingA)
    const spec = snap.spec
    const width = Math.max(10, e.props.bodyColumns - 8)
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
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {spec.title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {snap.featureDir}
        </Text>
        {row('Goal', spec.input ?? (spec.stories.map(s => s.title).join(' · ') || '-'))}
        {row('Vision', snap.constitution?.principles.length ? snap.constitution.principles.join(' · ') : 'no constitution yet')}
        {row('Now', task ? `${task.id}${task.story ? ` [${task.story}]` : ''} ${task.text}` : snap.tasks.length ? 'every task is checked' : 'no tasks.md yet', 'warning')}
        {task && (task.paths.length || reqs.length) ? row('', [task.paths.join(', '), reqs.join(' ')].filter(Boolean).join(' · '), 'subtle') : null}
        {row('Todo', open.length ? open.slice(0, 3).map(t => t.id).join(' · ') + (open.length > 3 ? ` · +${open.length - 3}` : '') : '-')}
        {row('Status', `${bar(report.done, report.tasks, 10)} ${report.done}/${report.tasks} tasks · FR ${report.covered}/${report.total}`)}
        {row('Drift', `● ${report.level}${ledger.semantic ? ` · intent ${ledger.semantic.score}/100` : ''}${checking ? ' · checking…' : ''}`, LEVEL_COLOR[report.level])}
        {report.findings
          .filter(f => f.kind !== 'intent')
          .slice(0, 5)
          .map(f => row('', `! ${f.text}`, f.level === 'red' ? 'error' : 'warning'))}
        {intents.slice(0, 3).map((f, i) => (
          <Box flexDirection="column">
            {row('', `! ${f.text}`, f.level === 'red' ? 'error' : 'warning')}
            <Box flexDirection="row" columnGap={1} marginLeft={8}>
              <Button key={`spec-${i}`} label="To spec" onPress={() => void toSpec($, f.intent ?? '')} />
              <Button key={`task-${i}`} label="As task" onPress={() => void asTask($, f.intent ?? '').then(text => $.ui.toast(text))} />
            </Box>
          </Box>
        ))}
        {report.uncovered.length ? row('', `uncovered: ${report.uncovered.join(' ')}`, 'subtle') : null}
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Button key="check" label="Check now" hotkey="c" onPress={() => void runCheck($, [], mapModel).then(text => $.ui.toast(text))} />
          <Button key="ack" label="Accept edits" hotkey="a" onPress={() => void update($, ledgerA, acknowledgeAll).then(() => persist($))} />
          {report.uncovered.length && snap.tasks.length ? <Button key="map" label="Map FR→tasks" hotkey="m" onPress={() => void runMap($, mapModel).then(text => $.ui.toast(text))} /> : null}
        </Box>
      </Box>
    )
  })
}
