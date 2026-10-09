import { mock } from 'claude-code/testing'

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

type Options = { env?: Record<string, string>; surfaces?: string[]; fork?: string; forkReason?: string; complete?: string; anchors?: string }

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
  const seen = { opened: [] as string[], toasts: [] as string[], commands: [] as string[], tools: [] as string[], forks: [] as string[], completes: [] as string[], submitted: [] as any[], ran: [] as string[][], commandsRun: [] as string[] }

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
    if (e.argv[0] === 'rg') {
      if (options.anchors !== undefined) return ok(options.anchors, options.anchors ? 0 : 1)
      const lines: string[] = []
      for (const [path, text] of Object.entries(files)) {
        if (/^(specs|\.specify)\//.test(path)) continue
        text.split('\n').forEach((line, i) => {
          const m = /@spec\s+\S+/.exec(line)
          if (m) lines.push(`./${path}:${i + 1}:${m[0]}`)
        })
      }
      return ok(lines.join('\n'), lines.length ? 0 : 1)
    }
    if (e.argv[0] === 'git' && e.argv[1] === 'diff') return ok(`diff --git a/src/auth/token.ts b/src/auth/token.ts\n+export const ttl = 15 * 60\n`)
    if (e.argv[0] === 'git' && e.argv[1] === 'status') return ok(' M src/auth/token.ts\n')
    return { deny: 'ENOENT' }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('ui.open', ($: any, e: any) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
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
    const path = typeof e.file_path === 'string' ? rel(e.file_path) : null
    if (path && e.tool === 'Write') write(path, e.content)
    if (path && e.tool === 'Edit') write(path, path in files ? files[path]!.replace(e.old_string, e.new_string) : e.new_string)
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn beneath'] }))
  on('session.start', () => ({ cwd: ROOT }))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 10) })
  return { files, clock, write, ...seen }
}

export async function startSession($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
}

export const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Write'], outputStyle: null, traits: [] } as const

/** The person typing a prompt at the terminal, and running /xref. */
export const type = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
export const xref = ($: any, args = '') => $.command.run({ command: 'xref', args })

export async function endTurn($: any) {
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 'turn-1' })
}

export const ledgerOf = (files: Record<string, string>) => JSON.parse(files[`${FEATURE}/xref.json`] ?? 'null')

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
