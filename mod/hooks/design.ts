// The design step (0.5.1): a feature people look at gets its look settled after the plan and before the tasks.
// DESIGN.md at the project root is the design system (Google Stitch's format: YAML tokens on top, the reasons in
// prose); specs/<feature>/design/ holds the feature's screens: screens.md says which screen serves which story,
// and one static HTML mock per screen shows it. Pure: register.tsx reads the files.

import type { Design, Screen, Snapshot } from '../types'
import { fingerprint } from './rules'

export const DESIGN_FILE = 'DESIGN.md'
export const designDir = (featureDir: string) => `${featureDir}/design`
export const screensPath = (featureDir: string) => `${designDir(featureDir)}/screens.md`

const field = (markdown: string | null, name: string) => {
  const value = new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi').exec(markdown ?? '')?.[1]?.trim()
  // The plan template's own placeholder (`[e.g., library/cli/web-service/mobile-app …]`) says nothing yet.
  return value && !/NEEDS CLARIFICATION|^\[/.test(value) ? value : null
}

/** Whether plan.md describes something people look at: its Project Type, else its Target Platform. */
export function uiFromPlan(planMd: string | null): boolean {
  const type = field(planMd, 'Project Type')
  if (type) {
    if (/\b(mobile|desktop|frontend|front-end|gui|ui|spa|website|web[- ]?app|web application|browser extension|game)\b/i.test(type)) return true
    if (/\b(cli|library|lib|compiler|sdk|web[- ]?service|api|backend|server|daemon|service)\b/i.test(type)) return false
    if (/\bweb\b/i.test(type)) return true
  }
  const platform = field(planMd, 'Target Platform')
  return !!platform && /\b(iOS|iPadOS|Android|browsers?|web|watchOS|tvOS)\b/i.test(platform)
}

const IDS = /\b(?:US\d+(?:-AS\d+)?|(?:FR|SC)-\d{3,})\b/g
/** A mock is a file beside screens.md: no way up, no scheme, a page or a picture. */
const MOCK = /^(?!.*\.\.)[\w][\w./-]*\.(?:html?|png|svg|jpe?g|webp)$/i

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())

/** screens.md: its table of screens (Screen | Serves | Mock | Notes) and what the step did to DESIGN.md. */
export function parseScreens(markdown: string): { screens: Screen[]; change: Design['change'] } {
  const change = field(markdown, 'Design system')?.toLowerCase().match(/created|extended|unchanged/)?.[0] as Design['change'] | undefined
  const lines = markdown.split('\n')
  const screens: Screen[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const head = cells(lines[i]!).map(c => c.toLowerCase())
    if (!lines[i]!.includes('|') || !head.some(c => c.startsWith('screen')) || !/^\s*\|?\s*:?-+/.test(lines[i + 1]!)) continue
    const col = (re: RegExp) => head.findIndex(c => re.test(c))
    const at = { name: col(/^screen/), serves: col(/serves|stor|requirement/), mock: col(/^mock/), notes: col(/^notes?/) }
    for (let j = i + 2; j < lines.length && lines[j]!.includes('|'); j++) {
      const row = cells(lines[j]!)
      const name = (row[at.name] ?? '').replace(/\*\*/g, '').trim()
      if (!name) continue
      const raw = at.mock >= 0 ? (row[at.mock] ?? '') : ''
      const target = (/\]\(([^)\s]+)\)/.exec(raw)?.[1] ?? /`([^`]+)`/.exec(raw)?.[1] ?? raw).replace(/^\.\//, '')
      screens.push({
        name,
        serves: [...new Set((at.serves >= 0 ? (row[at.serves] ?? '') : '').match(IDS) ?? [])],
        mock: MOCK.test(target) ? target : null,
        notes: at.notes >= 0 ? (row[at.notes] ?? '') : '',
      })
    }
    break
  }
  return { screens, change: change ?? null }
}

/** The feature's design as the snapshot holds it; the fingerprint is what the person approves at the design review. */
export function designState(designMd: string | null, screensMd: string | null): Design {
  const parsed = screensMd === null ? null : parseScreens(screensMd)
  return {
    system: designMd !== null,
    screens: parsed?.screens ?? null,
    change: parsed?.change ?? null,
    fingerprint: fingerprint(`${designMd ?? ''}\n---\n${screensMd ?? ''}`),
  }
}

/** What `git status --porcelain -- DESIGN.md` says happened to it since the last commit. */
export function designChangeFromGit(porcelain: string): 'created' | 'extended' | 'unchanged' {
  const code = porcelain.split('\n').find(l => l.trim())?.slice(0, 2) ?? ''
  return !code ? 'unchanged' : /\?\?|A/.test(code) ? 'created' : 'extended'
}

/** What the person is told about DESIGN.md at the review: what git shows, and where screens.md claims otherwise. */
export function designChangeLine(design: Design): string {
  const shown = design.verified ?? design.change
  const said = shown === 'created' ? ', a new DESIGN.md' : shown === 'extended' ? ', DESIGN.md extended' : ''
  const differs = design.verified && design.change && design.verified !== design.change
  return differs ? `${said} (screens.md says "${design.change}", but git shows DESIGN.md ${design.verified === 'unchanged' ? 'unchanged' : design.verified})` : said
}

/** Whether the design step still has to run: no screens.md yet, or screens without a design system to draw on. */
export const designDue = (design: Design | null | undefined) => !design || design.screens === null || (design.screens.length > 0 && !design.system)

/** Whether there is something for the person to look at: screens, or a design system this step wrote or extended. */
export const designToReview = (design: Design) => (design.screens?.length ?? 0) > 0 || (design.verified ?? design.change) === 'created' || (design.verified ?? design.change) === 'extended'

/** DESIGN.md's tokens the dashboard shows: its name, its colours (name and value), its font families. */
export function designTokens(designMd: string): { name: string | null; colors: [string, string][]; fonts: string[] } {
  const front = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(designMd)?.[1] ?? ''
  const colors: [string, string][] = []
  let block = ''
  for (const line of front.split('\n')) {
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      block = top[1]!
      continue
    }
    const entry = block === 'colors' ? /^\s+([\w-]+):\s*["']?(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/]+\))["']?\s*(?:#.*)?$/i.exec(line) : null
    if (entry) colors.push([entry[1]!, entry[2]!])
  }
  const fonts = [...new Set([...front.matchAll(/fontFamily:\s*["']?([^,}"'\n]+)/g)].map(m => m[1]!.trim()))]
  return { name: /^name:\s*["']?(.+?)["']?\s*$/m.exec(front)?.[1] ?? null, colors, fonts }
}

/** What the design step hands Claude. */
export function designPrompt(snap: Snapshot): string {
  const dir = designDir(snap.featureDir ?? 'specs/<feature>')
  return [
    `Settle the look of ${snap.featureDir} before its tasks are written, with the speckit-xref:design skill.`,
    snap.design?.system
      ? `${DESIGN_FILE} at the root is the project's design system: keep its tokens; add one only where this feature needs it, and say so in screens.md.`
      : snap.folder === 'existing'
        ? `There is no ${DESIGN_FILE} yet. Where the code already has a look (a theme, colours, fonts, spacing), write down what is there instead of redesigning it; otherwise create it in the format the skill gives.`
        : `There is no ${DESIGN_FILE} yet: create it in the format the skill gives.`,
    `The direction comes from ${snap.productBrief ? ".specify/memory/product-brief.md (its Design line is the person's decision), " : ''}the constitution and the spec; what nobody decided, decide and list under Assumptions in ${DESIGN_FILE}.`,
    `Write ${dir}/screens.md (which screen serves which user story and FR) and one static HTML mock per screen beside it: no scripts, ${DESIGN_FILE}'s tokens as CSS variables, real text in the app's language, the main platform's frame. No @spec anchors in the mocks.`,
    'A feature that adds or changes no screen writes screens.md with "No screen changes" and no mocks.',
    "Do not ask the person here: they look at the design system and the mocks at the design review that follows.",
  ].join('\n')
}

/** What the tasks and implement steps are told once the feature has screens. */
export const designNote = (featureDir: string) =>
  `Build to ${DESIGN_FILE} and ${screensPath(featureDir)}: its tokens go into the app's theme (one early task, if the app has none yet), and each screen is built in the story it serves, to its mock in ${designDir(featureDir)}/.`
