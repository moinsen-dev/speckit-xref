// The dashboard: one self-contained HTML page with more than the pane can hold. Pure: register.tsx writes it to
// .specify/xref/local/dashboard.html after every autopilot step; the person opens it via file://.

import type { Autopilot, Ledger, RunEntry, Screen, Snapshot, Task } from '../types'
import type { designTokens } from './design'
import { LADDER, owners } from './proof'
import type { Rung } from './proof'
import { isTestFile, localId } from './rules'
import { phaseLabel, phaseNumber, taskPhases } from './workflow'
import { openUnplanned, reqsOf } from './xref'
import type { Level, Report } from './xref'

/** A Spec Kit document shown on the page; `path` is project-relative (`specs/001-x/spec.md`). */
export type DashboardDoc = { path: string; title: string; markdown: string }
export type DashboardInput = {
  generatedAt: string
  root: string
  snap: Snapshot
  ledger: Ledger
  report: Report
  levels: Record<string, Rung>
  step: { phase: string; line: string; needsUser: string | null }
  strip: string
  autopilot: Autopilot
  runLog: RunEntry[]
  docs: DashboardDoc[]
  /** The feature's screens and DESIGN.md's tokens, once the design step has drawn them. */
  design?: { dir: string; screens: Screen[]; tokens: ReturnType<typeof designTokens>; approved: boolean } | null
  refreshSeconds: number
}

// ---- Escaping and links ----

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Text and attribute values alike: every attribute on the page is double-quoted. */
const esc = (text: string) => String(text).replace(/[&<>"']/g, c => ESC[c]!)

/** A project file as a file:// URL, each path segment encoded (a drive letter keeps its colon). */
function fileUrl(root: string, rel: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = `${base}/${rel.replace(/\\/g, '/').replace(/^\.?\//, '')}`
  const abs = path.startsWith('/') ? path : `/${path}`
  return 'file://' + abs.split('/').map(s => encodeURIComponent(s).replace(/%3A/gi, ':')).join('/')
}
const fileLink = (root: string, rel: string) => `<a class="path" href="${esc(fileUrl(root, rel))}">${esc(rel)}</a>`

/** Only http(s), file and relative links; no whitespace or control character a browser would strip. */
const safeUrl = (url: string) => !!url && !/[\u0000- \u007f]/.test(url) && (/^(?:https?|file):/i.test(url) || !/^[^/?#]*:/.test(url))

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** A doc's relative links point next to the doc, not next to the dashboard. */
function rebaser(root: string, docPath: string): (url: string) => string {
  const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : ''
  return url => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return url
    const cut = url.search(/[?#]/)
    const path = cut === -1 ? url : url.slice(0, cut)
    const parts: string[] = []
    for (const seg of ((path.startsWith('/') ? '' : dir) + path).split('/')) {
      if (seg === '..') parts.pop()
      else if (seg && seg !== '.') parts.push(decode(seg))
    }
    return fileUrl(root, parts.join('/')) + (cut === -1 ? '' : url.slice(cut))
  }
}

// ---- Markdown (a safe subset: everything escaped, then formatted) ----

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const emph = (t: string) =>
  t
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^\s_](?:[^_]*?[^\s_])?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')

function inline(raw: string, rebase?: (url: string) => string): string {
  const held: string[] = []
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`
  const restore = (t: string): string => t.replace(/\u0000(\d+)\u0000/g, (_m, k: string) => restore(held[Number(k)] ?? ''))
  const lines = raw.split('\n')
  // A soft break is a space; two trailing spaces, a backslash, or a next line opening on **Label** break the line.
  let s = lines
    .map((l, k) => (k === lines.length - 1 ? l.trim() : l.replace(/(?: {2,}|\\)$/, '').trim() + (/ {2,}$|\\$/.test(l) || /^\s*\*\*/.test(lines[k + 1]!) ? '\u0001' : ' ')))
    .join('')
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => hold(`<code>${esc(code.trim())}</code>`))
  s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g, (m, label: string, url: string) =>
    safeUrl(url) ? hold(`<a href="${esc(rebase ? rebase(url) : url)}">${emph(esc(label))}</a>`) : m,
  )
  return restore(emph(esc(s))).replace(/\u0001/g, '<br>')
}

function cells(row: string): string[] {
  const out: string[] = []
  const s = row.trim().replace(/^\|/, '')
  let cur = ''
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') (cur += '|'), (k += 1)
    else if (s[k] === '|') out.push(cur.trim()), (cur = '')
    else cur += s[k]
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

type Item = { indent: number; ordered: boolean; n: number; text: string }
function list(items: Item[], fmt: (t: string) => string): string {
  let html = ''
  const stack: { indent: number; tag: string }[] = []
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul'
    const open = `<${tag}${it.ordered && it.n !== 1 ? ` start="${it.n}"` : ''}>`
    while (stack.length && it.indent < stack[stack.length - 1]!.indent) html += `</li></${stack.pop()!.tag}>`
    const top = stack[stack.length - 1]
    if (top && it.indent === top.indent && top.tag === tag) html += '</li>'
    else if (top && it.indent === top.indent) (html += `</li></${top.tag}>${open}`), (top.tag = tag)
    else html += open, stack.push({ indent: it.indent, tag })
    const box = /^\[([ xX])\]\s+/.exec(it.text)
    html += box ? `<li class="task"><input type="checkbox" disabled${box[1] !== ' ' ? ' checked' : ''}> ${fmt(it.text.slice(box[0].length))}` : `<li>${fmt(it.text)}`
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`
  return html
}

const startsBlock = (lines: string[], i: number) => {
  const l = lines[i]!
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || ITEM.test(l) || (l.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('|'))
}

function md(markdown: string, rebase?: (url: string) => string): string {
  const lines = markdown.replace(/[\u0000\u0001]/g, '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
  const fmt = (t: string) => inline(t, rebase)
  const width = (s: string) => s.replace(/\t/g, '    ').length
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      for (i += 1; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) body.push(lines[i]!)
      i += 1
      out.push(`<pre><code${fence[2] ? ` class="lang-${esc(fence[2])}"` : ''}>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      out.push(`<h${h[1]!.length}>${fmt(h[2]!)}</h${h[1]!.length}>`)
      i += 1
      continue
    }
    if (HR.test(line)) {
      out.push('<hr>')
      i += 1
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''))
      out.push(`<blockquote>${md(body.join('\n'), rebase)}</blockquote>`)
      continue
    }
    if (line.includes('|') && (lines[i + 1] ?? '').includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''))
      const rows: string[][] = []
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) rows.push(cells(lines[i]!))
      const cell = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${fmt(c)}</${tag}>`
      out.push(
        `<div class="scroll"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>` +
          rows.map(r => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('') +
          '</tbody></table></div>',
      )
      continue
    }
    if (ITEM.test(line)) {
      const items: Item[] = []
      while (i < lines.length) {
        const l = lines[i]!
        const m = ITEM.exec(l)
        if (m && !HR.test(l)) {
          items.push({ indent: width(m[1]!), ordered: /\d/.test(m[2]!), n: parseInt(m[2]!, 10) || 1, text: m[3]! })
          i += 1
        } else if (!l.trim()) {
          // A blank line ends the list unless an item or an indented line follows it.
          let j = i + 1
          while (j < lines.length && !lines[j]!.trim()) j++
          if (j < lines.length && (ITEM.test(lines[j]!) || /^\s{2,}\S/.test(lines[j]!)) && !FENCE.test(lines[j]!) && !HR.test(lines[j]!)) i = j
          else break
        } else if (/^\s+\S/.test(l) && !FENCE.test(l)) {
          items[items.length - 1]!.text += '\n' + l.trim()
          i += 1
        } else break
      }
      out.push(list(items, fmt))
      continue
    }
    const para = [line]
    for (i += 1; i < lines.length && lines[i]!.trim() && !startsBlock(lines, i); i++) para.push(lines[i]!)
    out.push(`<p>${fmt(para.join('\n'))}</p>`)
  }
  return out.join('\n')
}

/** Markdown to HTML: headings, paragraphs, emphasis, code, lists, task boxes, tables, safe links, quotes, rules. */
export function markdownToHtml(markdown: string): string {
  return md(markdown)
}

const ID = /\b(?:(?:FR|SC)-\d{3,}|US\d+-AS\d+|T\d{3,})\b/g
const SKIP = /^<(\/?)(a|code|pre|script|style|title|textarea)\b/i

/** FR-### / SC-### / USn-ASm link to their matrix row, T### to its task; text inside links and code stays as it is. */
export function linkIds(html: string): string {
  let skip = 0
  return html.replace(/<[^>]*>|[^<]+/g, part => {
    if (part.startsWith('<')) {
      const m = SKIP.exec(part)
      if (m) skip = Math.max(0, skip + (m[1] ? -1 : 1))
      return part
    }
    return skip ? part : part.replace(ID, id => `<a href="#${id.startsWith('T') ? 'task' : 'req'}-${id}">${id}</a>`)
  })
}

// ---- The page ----

const DRIFT: Record<Level, { glyph: string; word: string }> = {
  green: { glyph: '●', word: 'ok' },
  yellow: { glyph: '▲', word: 'watch' },
  red: { glyph: '✖', word: 'off-spec' },
  none: { glyph: '·', word: 'no feature' },
}
const RUNG_GLYPH: Record<Rung, string> = { specified: '○', planned: '◔', implemented: '◑', tested: '◕', passing: '●' }

const time = (iso: string) => esc(iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC'))
const two = (n: number) => String(n).padStart(2, '0')
const duration = (ms: number) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`
}
const thousands = (n: number) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const text = (s: string) => linkIds(esc(s))
const section = (id: string, title: string, body: string) => `<section id="${id}"><h2>${title}</h2>\n${body}\n</section>`
const ul = (items: string[], cls = '') => `<ul${cls ? ` class="${cls}"` : ''}>${items.map(i => `<li>${i}</li>`).join('')}</ul>`

const autopilotLabel = (a: Autopilot) => (!a.on ? '○ off' : a.paused ? `⏸ on · waiting for you: ${a.paused}` : `▶ on · step ${a.steps}/${a.max}`)

function header(input: DashboardInput): string {
  const { snap, report, autopilot } = input
  const d = DRIFT[report.level] ?? DRIFT.none
  const facts = [
    snap.featureDir ? `<code>${esc(snap.featureDir)}</code>` : 'no feature yet',
    snap.branch ? `branch <code>${esc(snap.branch)}</code>` : '',
    `generated <time datetime="${esc(input.generatedAt)}">${time(input.generatedAt)}</time>`,
  ].filter(Boolean)
  const counts = snap.featureDir ? [`tasks ${report.done}/${report.tasks}`, `FR planned or further ${report.covered}/${report.total}`] : []
  return [
    '<header>',
    '<p class="kicker">Spec X-Ref dashboard</p>',
    `<h1>${esc(snap.spec?.title ?? 'No feature yet')}</h1>`,
    `<p class="meta">${facts.join(' · ')}</p>`,
    `<p class="state"><span class="pill drift-${report.level}">drift ${d.glyph} ${d.word}</span> <span class="pill${autopilot.paused && autopilot.on ? ' wait' : ''}">autopilot ${esc(autopilotLabel(autopilot))}</span>${counts.map(c => ` <span class="pill quiet">${c}</span>`).join('')}</p>`,
    '</header>',
  ].join('\n')
}

function goal(input: DashboardInput): string {
  const { snap, autopilot } = input
  const words = snap.spec?.input
    ? `<blockquote class="words">${esc(snap.spec.input)}</blockquote>`
    : autopilot.idea
      ? `<p class="muted">Not specified yet. Your idea:</p><blockquote class="words">${esc(autopilot.idea)}</blockquote>`
      : '<p class="muted">No spec yet: your words appear here once spec.md is written.</p>'
  const principles = snap.constitution?.principles.length ? `<ol>${snap.constitution.principles.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : '<p class="muted">No constitution yet.</p>'
  return section('goal', 'Goal &amp; vision', `<h3>In your words</h3>\n${words}\n<h3>Principles of the constitution</h3>\n${principles}`)
}

function workflow(input: DashboardInput): string {
  const tokens = input.strip.match(/[✓◌▶·][^\s✓◌▶·]+(?: \d+\/\d+)?/g)
  const cls: Record<string, string> = { '✓': 'done', '◌': 'unreviewed', '▶': 'now', '·': 'todo' }
  const strip = tokens ? tokens.map(t => `<span class="st st-${cls[t[0]!] ?? 'todo'}">${esc(t)}</span>`).join(' ') : esc(input.strip)
  const waiting = input.step.needsUser ? `<div class="waiting" role="status"><strong>⏸ Waiting for you</strong><p>${text(input.step.needsUser)}</p></div>` : ''
  return section('workflow', 'Workflow', `<p class="strip">${strip}</p>\n<p><span class="label">Next step</span> ${text(input.step.line)}</p>\n${waiting}`)
}

/** The look: DESIGN.md's colours and fonts, and each screen with its mock in place (a sandboxed frame, no scripts). */
function design(input: DashboardInput): string {
  const d = input.design
  if (!d) return ''
  const { colors, fonts, name } = d.tokens
  const swatches = colors.length
    ? `<div class="swatches">${colors.map(([n, v]) => `<span class="swatch"><span class="chip" style="background:${esc(v)}"></span><code>${esc(n)}</code> <span class="muted">${esc(v)}</span></span>`).join('')}</div>`
    : '<p class="muted">DESIGN.md names no colours yet.</p>'
  const type = fonts.length ? `<p><span class="label">Type</span>${fonts.map(f => esc(f)).join(' · ')}</p>` : ''
  const cards = d.screens.map(sc => {
    const rel = sc.mock ? `${d.dir}/${sc.mock}` : null
    const url = rel ? fileUrl(input.root, rel) : null
    const view = !url
      ? '<p class="muted">No mock.</p>'
      : /\.html?$/i.test(sc.mock!)
        ? `<div class="frame"><iframe src="${esc(url)}" title="${esc(sc.name)}" loading="lazy" sandbox></iframe></div>`
        : `<img class="mock" src="${esc(url)}" alt="${esc(sc.name)}" loading="lazy">`
    return (
      `<figure class="screen"><figcaption><strong>${esc(sc.name)}</strong>${sc.serves.length ? ` <span class="ids">${text(sc.serves.join(' '))}</span>` : ''}` +
      `${sc.notes ? `<br><span class="muted">${esc(sc.notes)}</span>` : ''}</figcaption>${view}${url ? `<p class="open-file"><a href="${esc(url)}">Open the mock</a></p>` : ''}</figure>`
    )
  })
  const state = `<p class="state"><span class="pill${d.approved ? ' drift-green' : ' wait'}">${d.approved ? '✓ approved by you' : '⏸ not approved yet'}</span>${name ? ` <span class="pill quiet">${esc(name)}</span>` : ''}</p>`
  return section('design', 'Design', `${state}\n${swatches}\n${type}\n${d.screens.length ? `<div class="screens">${cards.join('')}</div>` : '<p class="muted">No screen changes in this feature.</p>'}`)
}

function phases(input: DashboardInput): string {
  const { snap, autopilot, step } = input
  const { phases: list, current } = taskPhases(snap.tasks)
  if (!list.length) return section('phases', 'Phases', '<p class="muted">No tasks.md yet.</p>')
  const named = snap.phase ? list.findIndex(p => p.title === snap.phase) : -1
  const run = named >= 0 ? named : current
  const running = autopilot.on && !autopilot.paused && ['implement', 'repair'].includes(step.phase)
  const rows = list.map((p, i) => {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
    const state = i === run ? (running ? '▶ running' : '▶ next') : p.done === p.total ? '✓ done' : '· open'
    const cls = i === run ? 'now' : p.done === p.total ? 'done' : ''
    return (
      `<tr class="${cls}"><td class="num">${phaseNumber(p.title, i)}</td><td><a href="#phase-${i}">${esc(phaseLabel(p.title))}</a></td>` +
      `<td class="progress"><span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><span style="width:${pct}%"></span></span> ${p.done}/${p.total}</td>` +
      `<td class="nowrap">${state}</td></tr>`
    )
  })
  return section('phases', 'Phases of tasks.md', `<div class="scroll"><table class="phases"><thead><tr><th>#</th><th>Phase</th><th>Progress</th><th>State</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`)
}

function matrix(input: DashboardInput): string {
  const { snap, ledger, levels, root } = input
  const spec = snap.spec
  if (!spec) return section('matrix', 'Traceability', '<p class="muted">No spec yet.</p>')
  const proof = { featureDir: snap.featureDir, tasks: snap.tasks, reqs: spec.reqs, realTests: snap.realTests ?? [] }
  const row = (id: string, body: string, rung: string, cls: string) => {
    const own = owners(id, proof, ledger)
    const files = new Set<string>()
    for (const t of own) for (const f of [...(ledger.tasks[t.id]?.touched ?? []), ...(ledger.tasks[t.id]?.linked ?? [])]) files.add(f)
    for (const f of ledger.requirements[id]?.files ?? []) files.add(f)
    for (const a of ledger.anchors) if (localId(a.id, snap.featureDir) === id) files.add(a.file)
    const tasks = own.map(t => `<a class="${t.done ? 'done' : ''}" href="#task-${esc(t.id)}">${esc(t.id)}</a>${t.done ? ' ✓' : ''}`).join(', ')
    const fileList = [...files].map(f => `${fileLink(root, f)}${isTestFile(f) ? ' <span class="tag">test</span>' : ''}`).join('<br>')
    const v = ledger.verification[id]
    const verified = v
      ? `<span class="${v.status === 'passing' ? 'ok' : 'bad'}" title="${esc(v.tests.join('\n'))}">${v.status === 'passing' ? '✓ passing' : '✖ failing'}</span> · ${v.tests.length} test${v.tests.length === 1 ? '' : 's'} · ${esc(v.at.slice(0, 10))}`
      : '<span class="muted">—</span>'
    return `<tr id="req-${esc(id)}" class="${cls}"><td class="id"><a href="#req-${esc(id)}">${esc(id)}</a></td><td>${body}</td><td>${rung}</td><td class="ids">${tasks || '<span class="muted">none</span>'}</td><td class="files">${fileList || '<span class="muted">none</span>'}</td><td>${verified}</td></tr>`
  }
  const reqs = [...spec.reqs.filter(r => r.kind === 'FR'), ...spec.reqs.filter(r => r.kind === 'SC')]
  const rows = reqs.map(r => {
    const active = r.status === 'active'
    const level = levels[r.id]
    const rung = !active
      ? `<span class="rung r-gone">${r.status === 'superseded' ? '↷ superseded' : '✕ retired'}</span>`
      : level && (LADDER as readonly string[]).includes(level)
        ? `<span class="rung r-${level}">${RUNG_GLYPH[level]} ${level}</span>`
        : '<span class="muted">—</span>'
    const flags = [r.needsClarification ? '<span class="tag warn">▲ needs clarification</span>' : '', r.supersededBy ? `<span class="tag">→ ${text(r.supersededBy)}</span>` : ''].filter(Boolean).join(' ')
    const body = `${active ? text(r.text) : `<s>${text(r.text)}</s>`}${flags ? ` ${flags}` : ''}`
    return row(r.id, body, rung, active ? '' : 'gone')
  })
  const scenarios = spec.stories.flatMap(s => s.scenarios.map(x => row(x.id, `<span class="muted">${esc(s.id)} ${esc(s.title)}:</span> ${text(x.text)}`, '<span class="muted">—</span>', 'scenario')))
  const all = [...rows, ...scenarios]
  const legend = `<p class="legend">${LADDER.map(r => `<span class="rung r-${r}">${RUNG_GLYPH[r]} ${r}</span>`).join(' ')}</p>`
  return section(
    'matrix',
    'Traceability',
    `${legend}\n<div class="scroll"><table class="matrix"><thead><tr><th>Id</th><th>Requirement</th><th>Proof</th><th>Tasks</th><th>Files</th><th>Verified</th></tr></thead><tbody>${all.join('\n') || '<tr><td colspan="6" class="muted">No requirements in spec.md.</td></tr>'}</tbody></table></div>`,
  )
}

function taskRow(t: Task, input: DashboardInput): string {
  const reqs = reqsOf(t, input.ledger)
  const tags = [t.story ? `<span class="tag">${esc(t.story)}</span>` : '', t.parallel ? '<span class="tag" title="parallel">P</span>' : ''].filter(Boolean).join(' ')
  return (
    `<tr id="task-${esc(t.id)}" class="${t.done ? 'done' : ''}"><td class="check" title="${t.done ? 'done' : 'open'}">${t.done ? '☑' : '☐'}</td>` +
    `<td class="id"><a href="#task-${esc(t.id)}">${esc(t.id)}</a></td><td>${tags ? `${tags} ` : ''}${text(t.text)}</td>` +
    `<td class="files">${t.paths.map(p => fileLink(input.root, p)).join('<br>')}</td><td class="ids">${text(reqs.join(', '))}</td></tr>`
  )
}

function tasks(input: DashboardInput): string {
  const { phases: list } = taskPhases(input.snap.tasks)
  if (!list.length) return section('tasks', 'Tasks', '<p class="muted">No tasks.md yet.</p>')
  const body = list.map((p, i) => {
    const own = input.snap.tasks.filter(t => (t.phase || 'Tasks') === p.title)
    return `<h3 id="phase-${i}">${phaseNumber(p.title, i)} · ${esc(phaseLabel(p.title))} <span class="muted">${p.done}/${p.total}</span></h3>\n<div class="scroll"><table class="tasks"><tbody>${own.map(t => taskRow(t, input)).join('')}</tbody></table></div>`
  })
  return section('tasks', 'Tasks', body.join('\n'))
}

function drift(input: DashboardInput): string {
  const { snap, ledger, report, root } = input
  const d = DRIFT[report.level] ?? DRIFT.none
  const parts: string[] = [`<p><span class="pill drift-${report.level}">${d.glyph} ${d.word}</span></p>`]
  if (report.findings.length) {
    parts.push(ul(report.findings.map(f => `<span class="${f.level === 'red' ? 'bad' : 'warn'}">${f.level === 'red' ? '✖' : '▲'} ${f.level}</span> ${text(f.text)}`), 'findings'))
  } else parts.push('<p>● Nothing off the spec right now.</p>')
  if (report.notes.length) parts.push('<h3>Notes</h3>', ul(report.notes.map(text)))
  const open = openUnplanned(snap, ledger)
  if (open.length) {
    parts.push(
      '<h3>Edits outside the plan</h3>',
      `<div class="scroll"><table><thead><tr><th>File</th><th>Since</th><th>Task in focus</th></tr></thead><tbody>${open
        .map(u => `<tr><td class="files">${fileLink(root, u.file)}</td><td class="nowrap">${time(u.at)}</td><td>${u.task ? text(u.task) : '—'}</td></tr>`)
        .join('')}</tbody></table></div>`,
    )
  }
  if (ledger.decisions.length) {
    parts.push(
      '<h3>Decisions</h3>',
      ul(
        ledger.decisions.map(dec => {
          const answer = dec.answer ? `<span class="ok">✓</span> ${esc(dec.answer)}` : `<span class="warn">▲ open</span>${dec.options.length ? ` <span class="muted">(${esc(dec.options.join(' / '))})</span>` : ''}`
          return `${text(dec.question)} → ${answer}${dec.blocks.length ? ` <span class="muted">blocks ${esc(dec.blocks.join(', '))}</span>` : ''}`
        }),
      ),
    )
  }
  const s = ledger.semantic
  const changed = ledger.intents.filter(i => i.status !== 'logged').slice().reverse()
  if (s || changed.length) {
    const status = { extends: '▲ beyond the spec', contradicts: '✖ contradicts the spec', resolved: '✓ in the spec now', logged: '· logged' } as const
    const check = s ? `<p>Intent check <strong>${s.score}/100</strong> · ${esc(s.verdict)} · ${time(s.at)}</p>${s.reasons.length ? ul(s.reasons.map(text)) : ''}` : ''
    const list = changed.length ? ul(changed.map(i => `<span class="${i.status === 'contradicts' ? 'bad' : i.status === 'resolved' ? 'ok' : 'warn'}">${status[i.status]}</span> "${text(i.text)}" <span class="muted">${time(i.at)}</span>`)) : ''
    parts.push('<h3>Intent changes</h3>', check, list)
  }
  return section('drift', 'Drift', parts.join('\n'))
}

function runLog(input: DashboardInput): string {
  if (!input.runLog.length) return section('runlog', 'Run log', '<p class="muted">No autopilot step yet.</p>')
  const rows = [...input.runLog].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.step - a.step))
  const body = rows
    .map(
      r =>
        `<tr><td class="nowrap">${time(r.at)}</td><td class="num">${r.step}</td><td>${esc(r.phase)}</td><td class="ids">${r.task ? text(r.task) : '—'}</td>` +
        `<td class="num">${duration(r.durationMs)}</td><td class="num">${thousands(r.tokens)}</td><td class="num" title="${esc(r.files.join('\n'))}">${r.files.length}</td><td>${text(r.outcome)}</td></tr>`,
    )
    .join('')
  return section('runlog', 'Run log', `<div class="scroll"><table><thead><tr><th>Time</th><th>Step</th><th>Phase</th><th>Task(s)</th><th>Duration</th><th>Tokens</th><th>Files</th><th>Outcome</th></tr></thead><tbody>${body}</tbody></table></div>`)
}

function docs(input: DashboardInput): string {
  if (!input.docs.length) return section('docs', 'Documents', '<p class="muted">No documents yet.</p>')
  const body = input.docs.map(doc => {
    const open = /(^|\/)spec\.md$/.test(doc.path) ? ' open' : ''
    return (
      `<details class="doc" data-key="${esc(doc.path)}"${open}><summary><strong>${esc(doc.title)}</strong> <code>${esc(doc.path)}</code></summary>` +
      `<p class="open-file"><a href="${esc(fileUrl(input.root, doc.path))}">Open the file</a></p>` +
      `<div class="md">${linkIds(md(doc.markdown, rebaser(input.root, doc.path)))}</div></details>`
    )
  })
  return section('docs', 'Documents', body.join('\n'))
}

/** Reloads every `seconds`, keeping the scroll position and the open documents; waits while text is selected or the tab is hidden. */
function refreshScript(seconds: number): string {
  const ms = Math.max(1, Math.min(86400, Math.floor(seconds))) * 1000
  return `<script>
(function () {
  var KEY = 'speckit-xref-dashboard';
  function docs() { return Array.prototype.slice.call(document.querySelectorAll('details[data-key]')); }
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && saved.open) {
      docs().forEach(function (d) { d.open = saved.open.indexOf(d.getAttribute('data-key')) !== -1; });
      window.scrollTo(0, saved.y || 0);
    }
  } catch (e) {}
  function tick() {
    var selected = false;
    try { selected = !!window.getSelection && String(window.getSelection()) !== ''; } catch (e) {}
    if (document.hidden || selected) { setTimeout(tick, 2000); return; }
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ y: window.scrollY, open: docs().filter(function (d) { return d.open; }).map(function (d) { return d.getAttribute('data-key'); }) }));
    } catch (e) {}
    location.reload();
  }
  setTimeout(tick, ${ms});
})();
</script>`
}

const CSS = `
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e1db;--card:#fff;--accent:#2f5bd3;--ok:#1f7a3f;--warn:#8a6100;--bad:#b3261e;--ok-bg:#e6f4ea;--warn-bg:#fff4d6;--bad-bg:#fde8e6;--hl:#fff8e1;
--r-specified:#6b6b70;--r-planned:#2f5bd3;--r-implemented:#7a4cc2;--r-tested:#0e7c86;--r-passing:#1f7a3f}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa2;--line:#2e2e33;--card:#1c1c20;--accent:#8fb0ff;--ok:#6fd08f;--warn:#e8c25a;--bad:#ff8a80;--ok-bg:#16301f;--warn-bg:#33290f;--bad-bg:#3a1714;--hl:#2a2614;
--r-specified:#a0a0a8;--r-planned:#8fb0ff;--r-implemented:#c4a2ff;--r-tested:#5fd4dc;--r-passing:#6fd08f}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:76rem;padding:0 16px 2rem;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:break-word}
section,[id^="req-"],[id^="task-"]{scroll-margin-top:3rem}h1{font-size:1.6rem;margin:.2rem 0}h2{font-size:1.2rem;margin:2rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}h3{font-size:1rem;margin:1.2rem 0 .4rem}
a{color:var(--accent)}a.done{color:var(--ok)}code,pre,.strip{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:0 .25em}pre{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.75em}pre code{border:0;padding:0}
header{padding:1.2rem 0 .6rem}.kicker{margin:0;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.06em}.meta{margin:.2rem 0;color:var(--muted)}
.state{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.1em .7em;background:var(--card);font-size:.9em}
.pill.quiet{color:var(--muted)}.pill.wait{background:var(--warn-bg);color:var(--warn);border-color:currentColor}
.drift-green{background:var(--ok-bg);color:var(--ok);border-color:currentColor}.drift-yellow{background:var(--warn-bg);color:var(--warn);border-color:currentColor}.drift-red{background:var(--bad-bg);color:var(--bad);border-color:currentColor}.drift-none{color:var(--muted)}
nav{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.2rem 1rem;padding:.45rem 0;font-size:.9em}
.muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.nowrap{white-space:nowrap}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.words{white-space:pre-wrap;margin:0;padding:.6em 1em;border-left:3px solid var(--accent);background:var(--card);font-size:1.05em}
.strip{display:flex;flex-wrap:wrap;gap:.35rem}.st{border-radius:4px;padding:0 .35em;border:1px solid var(--line)}.st-done{color:var(--ok)}.st-unreviewed{color:var(--warn)}.st-now{background:var(--accent);color:var(--bg);border-color:var(--accent)}.st-todo{color:var(--muted)}
.label{font-weight:600;margin-right:.4em}.waiting{border:2px solid var(--warn);background:var(--warn-bg);border-radius:8px;padding:.6em 1em;margin:.8em 0}.waiting p{margin:.3em 0 0}
.scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:.92em}th,td{text-align:left;vertical-align:top;padding:.35em .5em;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
td.files,td.ids,td.id{overflow-wrap:anywhere}td.id{white-space:nowrap}.matrix td:nth-child(2){min-width:16em}.tasks td:nth-child(3){min-width:14em}
tr.now td{background:var(--hl)}tr.done td{color:var(--muted)}tr.gone td{color:var(--muted)}tr:target td{background:var(--warn-bg)}
.bar{display:inline-block;width:7em;height:.55em;background:var(--line);border-radius:999px;overflow:hidden;vertical-align:middle}.bar>span{display:block;height:100%;background:var(--accent)}tr.done .bar>span{background:var(--ok)}
.rung{display:inline-block;white-space:nowrap;border:1px solid currentColor;border-radius:999px;padding:0 .5em;font-size:.85em}
.r-specified{color:var(--r-specified)}.r-planned{color:var(--r-planned)}.r-implemented{color:var(--r-implemented)}.r-tested{color:var(--r-tested)}.r-passing{color:var(--r-passing);background:var(--ok-bg)}.r-gone{color:var(--muted)}
.tag{display:inline-block;font-size:.78em;border:1px solid var(--line);border-radius:4px;padding:0 .3em;color:var(--muted)}.tag.warn{color:var(--warn);border-color:currentColor}
.legend{display:flex;flex-wrap:wrap;gap:.35rem}.findings{padding-left:1.2em}
details.doc{border:1px solid var(--line);border-radius:8px;background:var(--card);margin:.6rem 0}details.doc>summary{cursor:pointer;padding:.6em .9em}details.doc>.md,details.doc>.open-file{padding:0 .9em}.open-file{margin:0}
.md h1{font-size:1.3rem}.md h2{font-size:1.1rem;border:0;margin-top:1.2rem}.md blockquote{border-left:3px solid var(--line);margin:.5em 0;padding:0 1em;color:var(--muted)}.md li.task{list-style:none}.md li.task input{margin:0 .3em 0 -1.2em}
.swatches{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin:.4rem 0}.swatch{display:inline-flex;align-items:center;gap:.35em}.chip{display:inline-block;width:1.4em;height:1.4em;border-radius:4px;border:1px solid var(--line)}
.screens{display:flex;flex-wrap:wrap;gap:1rem}.screen{margin:0;width:211px}.screen figcaption{font-size:.9em;margin-bottom:.3rem;min-height:2.6em}
.frame{width:197px;height:424px;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#fff}.frame iframe{width:390px;height:844px;border:0;transform:scale(.5);transform-origin:0 0}img.mock{max-width:100%;border:1px solid var(--line);border-radius:10px}
footer{margin-top:2.5rem;padding-top:.8rem;border-top:1px solid var(--line);color:var(--muted);font-size:.9em}
`

const NAV = [
  ['goal', 'Goal'],
  ['workflow', 'Workflow'],
  ['design', 'Design'],
  ['phases', 'Phases'],
  ['matrix', 'Traceability'],
  ['tasks', 'Tasks'],
  ['drift', 'Drift'],
  ['runlog', 'Run log'],
  ['docs', 'Documents'],
]

const FOOTER = 'This page is local and is regenerated after every step. It holds your own words: keep it out of commits and do not share it.'

/** The whole dashboard as one HTML document: deterministic for the same input, nothing loaded from outside. */
export function renderDashboard(input: DashboardInput): string {
  const refresh = Number(input.refreshSeconds)
  const auto = Number.isFinite(refresh) && refresh > 0
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(input.snap.spec?.title ?? 'Spec X-Ref')} · Spec X-Ref</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    header(input),
    `<nav>${NAV.filter(([id]) => id !== 'design' || input.design).map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav>`,
    '<main>',
    goal(input),
    workflow(input),
    design(input),
    phases(input),
    matrix(input),
    tasks(input),
    drift(input),
    runLog(input),
    docs(input),
    '</main>',
    `<footer><p>${FOOTER}</p>${auto ? `<p>Refreshes every ${Math.floor(refresh)} s; it waits while you select text or the tab is hidden.</p>` : ''}</footer>`,
    auto ? refreshScript(refresh) : '',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
