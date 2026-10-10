import { mock } from 'claude-code/testing'

import { ledgerFromParts, localPath } from '../hooks/ledger'

export const ROOT = '/work'
export const FEATURE = 'specs/001-magic-link-login'

export const PANE = {
  plugin: 'speckit-xref',
  component: 'Pane',
  requestId: 'speckit-xref',
  viewport: { columns: 180, rows: 40 },
  props: { title: 'Spec X-Ref', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

export const BAND = {
  plugin: 'speckit-xref',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type Options = {
  env?: Record<string, string>
  surfaces?: string[]
  fork?: string
  forkReason?: string
  complete?: string
  anchors?: string
  noRipgrep?: boolean
  untracked?: string[]
  onPath?: string[]
  classify?: string
  /** What the project's test command does: exit codes in turn (the last repeats), and its output. */
  tests?: { exits: number[]; output?: string }
  /** What `git diff --name-only` lists, as the working tree changes; the default is src/auth/token.ts. */
  changed?: () => string[]
  /** The person's answers to `$.ui.ask`, in turn; none means the dialog is dismissed. */
  answers?: string[]
  /** The git branch checked out. */
  branch?: string
  /** The subscription's usage windows, as /usage shows them. */
  rateLimits?: { kind: string; percentUsed: number }[]
  /** A git repository with (true) or without (false) a commit; absent, no git answers. */
  commits?: boolean
}

/** The project of the test running now: its turns start with the prompt submitted last, as the engine's do. */
export let lastSeen: { submitted: any[] } = { submitted: [] }

/** A turn as the engine runs one: it starts with the prompt waiting (the autopilot's step, or the person's), then ends. */
export async function runTurn($: any, answer = 'Done with this step.', reason = 'answer') {
  const turnId = `t-${Math.random()}`
  await $.turn.start({ text: lastSeen.submitted.at(-1)?.text ?? '', turnId })
  await $.turn.complete({ reason, answer, durationMs: 1000, isAborted: reason === 'aborted', turnId })
}

/** Stubs every call the mod makes over an in-memory project; `files` changes as the mod writes. */
export function project(on: any, files: Record<string, string>, options: Options = {}) {
  const rel = (path: string) => (path === ROOT ? '' : path.startsWith(ROOT + '/') ? path.slice(ROOT.length + 1) : path)
  const mtimes: Record<string, number> = {}
  let tick = 1
  const touch = (path: string) => (mtimes[path] = ++tick)
  Object.keys(files).forEach(touch)
  const write = (path: string, text: string) => {
    files[path] = text
    touch(path)
  }
  const isDir = (path: string) => path === '' || Object.keys(files).some(k => k.startsWith(path + '/'))
  const seen = { agents: [] as string[], deferred: [] as string[], compacted: [] as string[], testRuns: [] as string[], asked: [] as string[], notified: [] as string[], aborted: [] as string[], opened: [] as string[], toasts: [] as string[], commands: [] as string[], tools: [] as string[], forks: [] as string[], completes: [] as string[], submitted: [] as any[], ran: [] as string[][], commandsRun: [] as string[], classified: [] as string[], openArgs: [] as any[] }

  on('fs.read', ($: any, e: any) => (rel(e.path) in files ? { value: files[rel(e.path)] } : { deny: 'ENOENT' }))
  on('fs.write', ($: any, e: any) => {
    write(rel(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => ({ value: rel(e.path) in files || isDir(rel(e.path)) }))
  on('fs.stat', ($: any, e: any) => {
    const path = rel(e.path)
    if (path in files) return { value: { kind: 'file', size: files[path]!.length, mtimeMs: mtimes[path] ?? 1, isLink: false } }
    return isDir(path) ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }
  })
  on('fs.list', ($: any, e: any) => {
    const prefix = rel(e.path) ? rel(e.path) + '/' : ''
    const entries = new Map<string, any>()
    for (const key of Object.keys(files)) {
      if (!key.startsWith(prefix)) continue
      const [name, ...rest] = key.slice(prefix.length).split('/')
      entries.set(name!, { name, kind: rest.length ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })
    }
    return entries.size ? { value: [...entries.values()] } : { deny: 'ENOENT' }
  })
  on('env.get', ($: any, e: any) => ({ value: options.env?.[e.name] }))
  on('process.run', ($: any, e: any) => {
    seen.ran.push([...e.argv])
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'which') return ok('', (options.onPath ?? ['uvx']).includes(e.argv[1]) ? 0 : 1)
    const grep = e.argv[0] === 'rg' || (e.argv[0] === 'git' && e.argv[1] === 'grep')
    if (e.argv[0] === 'rg' && options.noRipgrep) return { deny: 'ENOENT' }
    if (grep) {
      if (options.anchors !== undefined) return ok(options.anchors, options.anchors ? 0 : 1)
      // git grep searches only what git tracks, unless it is asked for --untracked.
      const skipUntracked = e.argv[0] === 'git' && !e.argv.includes('--untracked')
      const lines: string[] = []
      for (const [path, text] of Object.entries(files)) {
        if (/^(specs|\.specify)\//.test(path)) continue
        if (skipUntracked && options.untracked?.includes(path)) continue
        text.split('\n').forEach((line, i) => {
          const m = /@spec\s+\S+/.exec(line)
          if (m) lines.push(`./${path}:${i + 1}:${m[0]}`)
        })
      }
      return ok(lines.join('\n'), lines.length ? 0 : 1)
    }
    if (e.argv[0] === 'sh' && options.tests) {
      seen.testRuns.push(e.argv[2])
      const exit = options.tests.exits[Math.min(seen.testRuns.length - 1, options.tests.exits.length - 1)] ?? 0
      return ok(options.tests.output ?? (exit ? 'FAIL tests/auth/token.test.ts' : 'ok'), exit)
    }
    if (e.argv[0] === 'git' && e.argv[1] === 'rev-parse' && e.argv.includes('--is-inside-work-tree')) return options.commits === undefined ? { deny: 'ENOENT' } : ok('true\n')
    if (e.argv[0] === 'git' && e.argv[1] === 'rev-parse' && e.argv.includes('--verify')) return ok('', options.commits ? 0 : 1)
    if (e.argv[0] === 'git' && e.argv[1] === 'rev-parse' && e.argv.includes('--abbrev-ref')) return options.branch ? ok(`${options.branch}\n`) : { deny: 'ENOENT' }
    if (e.argv[0] === 'git' && (e.argv[1] === 'add' || e.argv[1] === 'commit')) return ok('')
    if (e.argv[0] === 'git' && e.argv[1] === 'diff' && e.argv.includes('--cached')) return ok('')
    if (e.argv[0] === 'git' && e.argv[1] === 'hash-object') return ok(e.argv.slice(3).map((f: string) => `h-${f}-${mtimes[f] ?? 0}`).join('\n'))
    if (e.argv[0] === 'git' && e.argv[1] === 'diff' && e.argv.includes('--name-only')) return ok((options.changed ? options.changed() : ['src/auth/token.ts']).join('\n') + '\n')
    if (e.argv[0] === 'git' && e.argv[1] === 'diff') return ok(`diff --git a/src/auth/token.ts b/src/auth/token.ts\n+export const ttl = 15 * 60\n`)
    if (e.argv[0] === 'git' && e.argv[1] === 'ls-files') return ok('')
    return { deny: 'ENOENT' }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('ui.open', ($: any, e: any) => {
    seen.opened.push(e.id)
    seen.openArgs.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: seen.opened.map(id => ({ id, title: 'Spec X-Ref', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.toast', ($: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($: any, e: any) => {
    seen.commands.push(e.name)
    return { value: undefined }
  })
  on('tool.register', ($: any, e: any) => {
    seen.tools.push(e.name)
    if (e.isDeferred) seen.deferred.push(e.name)
    return { value: { tool: `mcp__speckit-xref__${e.name}` } }
  })
  on('model.fork', ($: any, e: any) => {
    seen.forks.push(e.prompt)
    return { value: options.fork ? { isAnswered: true, text: options.fork, usage: USAGE } : { isAnswered: false, reason: options.forkReason ?? 'empty-reply', usage: USAGE } }
  })
  on('model.complete', ($: any, e: any) => {
    seen.completes.push(e.prompt)
    return { value: options.complete ? { isAnswered: true, text: options.complete, usage: USAGE } : { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
  })
  on('model.classify', ($: any, e: any) => {
    seen.classified.push(e.text)
    return { value: options.classify ?? e.labels[1] }
  })
  on('prompt.submit', ($: any, e: any) => {
    seen.submitted.push(e)
    return { text: e.text, context: e.context }
  })
  on('command.run', ($: any, e: any) => {
    seen.commandsRun.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  // The tools beneath the mod write what they were asked to, as Write and Edit would.
  on('tool.call', ($: any, e: any) => {
    // $.ui.ask is the AskUserQuestion tool beneath the asking hook: the scripted answers stand in for the person.
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions?.[0]?.question ?? ''
      seen.asked.push(question)
      const answer = options.answers?.shift()
      if (answer === undefined) return { deny: 'dismissed' }
      return { result: { questions: e.questions, answers: { [question]: answer } } }
    }
    const path = typeof e.file_path === 'string' ? rel(e.file_path) : null
    if (path && e.tool === 'Write') write(path, e.content)
    if (path && e.tool === 'Edit') write(path, path in files ? files[path]!.replace(e.old_string, e.new_string) : e.new_string)
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('classic.Stop', () => ({}))
  on('agent.register', ($: any, e: any) => {
    seen.agents.push(e.name)
    return { value: { type: `speckit-xref:${e.name}` } }
  })
  on('session.compact', ($: any, e: any) => {
    seen.compacted.push(e.instructions ?? '')
    return { messages: e.messages }
  })
  on('skill.prompt', ($: any, e: any) => ({ text: e.text }))
  on('ui.notify', ($: any, e: any) => {
    seen.notified.push(e.text)
    return { value: { isSent: true, channel: 'terminal' } }
  })
  on('turn.abort', ($: any, e: any) => {
    seen.aborted.push(e.turnId)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: options.rateLimits ?? [], cost: { usd: 0.5 } } }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('ui.render', ($: any, e: any) => ({ type: 'Text', props: {}, children: [e.component === 'UserMessage' ? e.props.text : 'drawn beneath'] }))
  on('session.start', () => ({ cwd: ROOT }))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 10) })
  lastSeen = seen
  return { files, clock, write, ...seen }
}

export async function startSession($: any, cwd = ROOT) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd })
}

export const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Write'], outputStyle: null, traits: [] } as const

/** The person typing a prompt at the terminal, and running /xref. */
export const type = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
export const xref = ($: any, args = '') => $.command.run({ command: 'xref', args })

export async function endTurn($: any) {
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 'turn-1' })
}

/** The ledger as the mod keeps it: both files merged, the committed one under `committed`. */
export const ledgerOf = (files: Record<string, string>): any => {
  const committed = files[`${FEATURE}/xref.json`] ?? null
  const local = files[localPath(FEATURE)] ?? null
  return committed || local ? { ...ledgerFromParts(committed, local), committed: committed ? JSON.parse(committed) : null } : null
}

/** What a drawn element reads as: a column's children on lines of their own, a row's side by side. */
export function toText(element: any): string {
  if (element == null || element === false) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(toText).join('')
  const children = (element.children ?? []).map(toText)
  if (element.type === 'Button') return `[${element.props.label}]`
  if (element.type !== 'Box') return children.join('')
  return element.props?.flexDirection === 'column' ? children.filter(Boolean).join('\n') : children.join(element.props?.columnGap ? ' ' : '')
}
