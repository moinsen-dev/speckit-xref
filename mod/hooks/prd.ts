// The PRD entrance (0.5.3): a product requirements document the person wrote first. It is imported once to
// .specify/memory/prd.md, reviewed and cut into features (prd-review.md, roadmap.md), and each feature's spec carries
// the PRD's own ids, so the trace runs PRD → spec → tasks → code. Pure: register.tsx reads and writes the files.

import type { PrdReview, RoadmapItem, Snapshot, Spec } from '../types'
import { fingerprint } from './rules'

export const PRD = '.specify/memory/prd.md'
export const PRD_REVIEW = '.specify/memory/prd-review.md'
export const ROADMAP = '.specify/memory/roadmap.md'

/** A file at the root that is a PRD by its name: `PRD_Show.md`, `product-requirements.docx`. */
export const PRD_NAME = /(^|[^a-z])prd([^a-z]|$)|product[-_ ]?requirements/i
const PRD_EXT = /\.(md|markdown|docx)$/i

/** The PRD among the root's files: Markdown before Word, and never one of Spec Kit's own. */
export function prdSourceOf(names: string[]): string | null {
  const candidates = names.filter(n => PRD_NAME.test(n) && PRD_EXT.test(n) && !n.startsWith('.'))
  return candidates.find(n => /\.(md|markdown)$/i.test(n)) ?? candidates[0] ?? null
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)
const plain = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '').trim()

/** `US01–US06, F01, AC01-AC11` → every id, ranges expanded with the width they are written in. */
export function expandIds(scope: string): string[] {
  const out: string[] = []
  for (const part of scope.split(/[,;]|\s+und\s+|\s+and\s+/)) {
    const range = /([A-Z]+)-?(\d+)\s*[–—-]\s*(?:([A-Z]+)-?)?(\d+)/.exec(part)
    if (range && (!range[3] || range[3] === range[1])) {
      const [, prefix, from, , to] = range
      const width = from!.length
      for (let n = Number(from); n <= Number(to) && n - Number(from) < 200; n++) out.push(`${prefix}${String(n).padStart(width, '0')}`)
      continue
    }
    for (const m of part.matchAll(/\b([A-Z]{1,4}\d{1,3}[a-z]?)\b/g)) out.push(m[1]!)
  }
  return [...new Set(out)]
}

/** roadmap.md: one `##` section per feature, in build order, with its phase, scope, PRD sections, gate and spec text. */
export function parseRoadmap(markdown: string): RoadmapItem[] {
  const items: RoadmapItem[] = []
  let item: RoadmapItem | null = null
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(?:\d+[.)]?\s*)?(.+)$/.exec(line)
    if (heading) {
      item = { title: plain(heading[1]!), phase: null, scope: [], sections: [], gate: null, spec: '' }
      items.push(item)
      continue
    }
    const field = item ? /^\*\*(Phase|Scope|Sections|Gate before|Gate|Spec)\*\*\s*:\s*(.*)$/i.exec(line.trim()) : null
    if (!item) continue
    if (field) {
      const key = field[1]!.toLowerCase()
      const value = plain(field[2]!)
      if (key === 'phase') item.phase = value || null
      else if (key === 'scope') item.scope = expandIds(value)
      else if (key === 'sections') item.sections = [...value.matchAll(/§\s*(\d+(?:[ .]\d+)*)/g)].map(m => m[1]!.replace(/\s+/g, '.'))
      else if (key.startsWith('gate')) item.gate = /^(none|keine?|-|—)$/i.test(value) ? null : value
      else item.spec = value
    } else if (item.spec && line.trim() && !/^\s*(#|\*\*)/.test(line)) {
      // The spec text may wrap over several lines.
      item.spec += ' ' + line.trim()
    }
  }
  return items.filter(i => i.spec || i.scope.length)
}

/** prd-review.md: the recommendation and the decisions that block the first feature. */
export function parsePrdReview(markdown: string): PrdReview {
  const rec = /^\*\*Recommendation\*\*:\s*(.+)$/im.exec(markdown)?.[1]?.toLowerCase().match(/build|sharpen/)?.[0] as PrdReview['recommendation'] | undefined
  const blocking: string[] = []
  let inside = false
  for (const line of markdown.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      inside = /blocking|blockier/i.test(h[1]!)
      continue
    }
    const bullet = inside ? /^\s*[-*]\s+(.+)$/.exec(line) : null
    if (bullet) blocking.push(clip(plain(bullet[1]!), 200))
  }
  return { recommendation: rec ?? null, blocking }
}

/** What the person approves at the roadmap review: the review and the roadmap together. */
export const prdFingerprint = (review: string, roadmap: string) => fingerprint(`${review}\n---\n${roadmap}`)

/**
 * The PRD's sections a feature names (`§5`, `§6.1`), with their subsections, from headings numbered as the PRD
 * writes them (`## 5 Kleinster spielbarer Kern`, `### 6 1 Aufbau`, `### 6.1 …`). Bounded for the intent check.
 */
export function prdSections(prd: string, refs: string[], max = 4000): string {
  if (!refs.length) return ''
  const lines = prd.split('\n')
  const numbered = lines.map(l => /^(#{1,4})\s+(\d+(?:[ .]\d+)*)\.?\s+\D/.exec(l)).map(m => (m ? { level: m[1]!.length, num: m[2]!.replace(/\s+/g, '.') } : null))
  const out: string[] = []
  for (const ref of refs) {
    const start = numbered.findIndex(h => h && h.num === ref)
    if (start < 0) continue
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      const h = numbered[i]
      if (h && h.level <= numbered[start]!.level && !h.num.startsWith(`${ref}.`)) {
        end = i
        break
      }
    }
    out.push(lines.slice(start, end).join('\n').trim())
  }
  return clip(out.join('\n\n'), max)
}

/** Which of a feature's PRD ids its spec carries: in a requirement's text, a story's title or a scenario. */
export function prdCoverage(scope: string[], spec: Spec | null): { covered: string[]; missing: string[] } {
  const text = spec ? [...spec.reqs.map(r => r.text), ...spec.stories.flatMap(s => [s.title, ...s.scenarios.map(x => x.text)]), spec.input ?? ''].join('\n') : ''
  const has = (id: string) => new RegExp(`(^|[^A-Za-z0-9])${id}([^0-9]|$)`).test(text)
  return { covered: scope.filter(has), missing: scope.filter(id => !has(id)) }
}

/** The roadmap item a feature directory stands for: `specs/002-…` is the second. */
export function roadmapItemOf(snap: Pick<Snapshot, 'featureDir' | 'features' | 'roadmap'>): RoadmapItem | null {
  if (!snap.roadmap?.length || !snap.featureDir) return null
  const n = Number(/(?:^|\/)(\d{3})-/.exec(snap.featureDir)?.[1])
  const index = Number.isFinite(n) && n > 0 ? n - 1 : snap.features.indexOf(snap.featureDir)
  return snap.roadmap[index] ?? null
}

/** What /speckit-specify gets for a roadmap feature: its text and where it comes from. */
export const roadmapSpecify = (item: RoadmapItem) =>
  `${item.spec}${item.sections.length || item.scope.length ? ` (Source: ${PRD}${item.sections.length ? ` ${item.sections.map(s => `§${s}`).join(', ')}` : ''}${item.scope.length ? `; PRD ids ${item.scope.join(', ')}` : ''})` : ''}`

export const PRD_PROMPT = [
  `Review the person's PRD (${PRD}) and cut it into features, with the speckit-xref:prd skill.`,
  `Write ${PRD_REVIEW} (contradictions, untestable criteria, gaps per phase, and the open decisions that block the first feature, each with your recommendation) and ${ROADMAP} (one section per feature in build order: phase, scope as the PRD's own ids, the PRD sections it implements, the gate before it, and the spec text), in the formats the skill gives.`,
  'The PRD is the person\'s: do not rewrite it, do not research what it already researched, and do not decide its open decisions. The first feature is the smallest one the PRD itself says to build first.',
].join('\n')

export const PRD_SHAPE_PROMPT = [
  'Shape the first version from the PRD, with the speckit-xref:shape skill: its decisions (scope, platforms, language, design, data, stack) are the person\'s; take them as decided.',
  `Ask in the AskUserQuestion dialog only the open decisions ${PRD_REVIEW} lists as blocking the first feature, in one round, your recommendation first. Write .specify/memory/product-brief.md with them.`,
].join('\n')

export const PRD_NOTE =
  `The product comes from the person's PRD (${PRD}; review and roadmap beside it). Its decisions are the person's. Carry its ids: every requirement ends with the PRD id it comes from, e.g. "(PRD F01)"; every user story names its PRD story ("PRD US01"); acceptance scenarios cite the PRD's acceptance criteria ("PRD AC04").`
