// Pure readers for GitHub Spec Kit artifacts. No IO: register.tsx reads the files and hands the text in.

import type { Constitution, Spec, Story, Req, Task } from '../types'

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)
const unbold = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '').trim()

/** The bullet lines under the first `##`/`###` heading whose text matches `heading`, up to the next heading. */
function bulletsUnder(markdown: string, heading: RegExp, max: number): string[] {
  const out: string[] = []
  let inside = false
  for (const line of markdown.split('\n')) {
    const h = /^#{2,4}\s+(.*)$/.exec(line)
    if (h) {
      if (inside) break
      inside = heading.test(h[1] ?? '')
      continue
    }
    if (!inside) continue
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet && bullet[1] && !/^\[.*\]$/.test(bullet[1].trim())) out.push(clip(unbold(bullet[1]), 200))
    if (out.length >= max) break
  }
  return out
}

export function parseSpec(markdown: string): Spec {
  const titleLine = /^#\s+(?:Feature Specification:\s*)?(.+)$/m.exec(markdown)
  const inputLine = /^\*\*Input\*\*:\s*(?:User description:\s*)?(.+)$/m.exec(markdown)
  const input = inputLine?.[1] ? inputLine[1].trim().replace(/^"(.*)"$/, '$1').trim() : null

  const stories: Story[] = []
  for (const m of markdown.matchAll(/^###\s+User Story\s+(\d+)\s*[-–—:]\s*(.+?)\s*(?:\(Priority:\s*(P\d+)\))?\s*(?:🎯.*)?$/gm)) {
    stories.push({ id: `US${m[1]}`, title: unbold(m[2] ?? ''), priority: m[3] ?? null })
  }

  const reqs: Req[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(/^\s*[-*]\s*\*\*((FR|SC)-\d{3,})\*\*\s*:?\s*(.*)$/gm)) {
    const id = m[1] ?? ''
    if (seen.has(id)) continue
    seen.add(id)
    const text = m[3] ?? ''
    reqs.push({ id, kind: m[2] as 'FR' | 'SC', text: clip(unbold(text), 300), needsClarification: /NEEDS CLARIFICATION/i.test(text) })
  }

  return {
    title: titleLine?.[1]?.trim() ?? 'Untitled feature',
    input: input && !/^\$ARGUMENTS$/.test(input) ? clip(input, 600) : null,
    stories,
    reqs,
    outOfScope: bulletsUnder(markdown, /out of scope|non-goals?|not in scope/i, 8),
    assumptions: bulletsUnder(markdown, /^assumptions/i, 6),
  }
}

const PATH_EXT = /\.[a-z0-9]{1,6}$/i

/** File and directory paths named in a task's description: backticked, or bare tokens that look like paths. */
export function extractPaths(text: string): string[] {
  const found = new Set<string>()
  const keep = (raw: string) => {
    const path = raw.trim().replace(/^\.\//, '').replace(/[.,;:)]+$/, '')
    if (!path || /^https?:/i.test(path) || path.includes(' ') || path.length > 200) return
    if (path.includes('/') || PATH_EXT.test(path)) found.add(path)
  }
  for (const m of text.matchAll(/`([^`]+)`/g)) keep(m[1] ?? '')
  const bare = text.replace(/`[^`]*`/g, ' ')
  for (const m of bare.matchAll(/(?:^|[\s("'])((?:\.\/)?(?:[\w@.-]+\/)+[\w@.\[\]-]*|[\w-]+\.[a-z][a-z0-9]{0,5})(?=[\s,;:)"']|\.(?:\s|$)|$)/gi)) {
    const token = m[1] ?? ''
    // "e.g." or a version like "v1.2" is no file; a path names a folder or a known-looking extension.
    if (/^(e\.g|i\.e|etc|vs)\.?$/i.test(token) || /^v?\d+(\.\d+)+$/.test(token)) continue
    keep(token)
  }
  return [...found]
}

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = []
  let phase = ''
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      phase = unbold(heading[1] ?? '')
      continue
    }
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(?:\*\*)?(T\d{3,})(?:\*\*)?\s*(.*)$/.exec(line)
    if (!m) continue
    let rest = m[3] ?? ''
    const parallel = /\[P\]/.test(rest)
    const story = /\[(US\d+)\]/.exec(rest)?.[1] ?? null
    rest = rest.replace(/\[(P|US\d+)\]\s*/g, '').trim()
    tasks.push({
      id: m[2] ?? '',
      done: m[1] !== ' ',
      parallel,
      story,
      text: clip(rest, 240),
      paths: extractPaths(rest),
      reqs: [...new Set(rest.match(/\b(?:FR|SC)-\d{3,}\b/g) ?? [])],
      phase,
    })
  }
  return tasks
}

export function parseConstitution(markdown: string): Constitution {
  const principles: string[] = []
  const musts: string[] = []
  for (const line of markdown.split('\n')) {
    const h = /^###\s+(.+)$/.exec(line)
    // A template never filled in still reads [PRINCIPLE_1_NAME]; it says nothing yet.
    if (h && h[1] && !/\[[A-Z0-9_]+\]/.test(h[1])) principles.push(clip(unbold(h[1]), 80))
    if (/\bMUST\b/.test(line) && !/\[[A-Z0-9_]+\]/.test(line) && !/^#/.test(line)) {
      const text = unbold(line.replace(/^\s*[-*]\s*/, ''))
      if (text) musts.push(clip(text, 200))
    }
  }
  return { principles: principles.slice(0, 12), musts: musts.slice(0, 12) }
}

/** `.specify/feature.json` names the active feature's directory. */
export function parseFeatureJson(text: string): string | null {
  try {
    const value = JSON.parse(text) as { feature_directory?: unknown }
    return typeof value.feature_directory === 'string' && value.feature_directory ? value.feature_directory : null
  } catch {
    return null
  }
}
