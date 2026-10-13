// Acceptance (0.6.0): after verify, a feature people use is played through as a person would, scenario by scenario,
// by a driver that leaves evidence (Playwright for the web, Maestro for mobile). Only a fresh JUnit report of that
// driver accepts a scenario; acceptance.md lists what only a person can check. Pure: register.tsx reads the files.

import type { AcceptanceNote, Ledger, Snapshot, Spec } from '../types'
import type { JunitCase } from './proof'
import { fingerprint } from './rules'

export const ACCEPT_DIR = 'e2e/acceptance'
export const ACCEPT_REPORTS = 'reports'
/** The driver's reports the step writes: `reports/acceptance-web.xml`, `reports/acceptance-mobile.xml`. */
export const ACCEPT_REPORT = /^acceptance[\w.-]*\.xml$/
export const acceptanceDoc = (featureDir: string) => `${featureDir}/acceptance.md`

/** Files the acceptance step writes about the app, not into it: they do not change what was verified. */
export const ACCEPTANCE_ARTIFACT = /(^|\/)(e2e\/acceptance\/|reports\/acceptance[^/]*$|specs\/[^/]+\/acceptance\.md$|\.specify\/memory\/runbook\.md$)/

/** What the user test (0.8.0) writes about the app, not into it: its log and its screenshots. */
export const TRY_ARTIFACT = /(^|\/)specs\/[^/]+\/(try\.md$|try\/)/
/** The design pass's record and screenshots (0.9.0): a review that finds nothing changes nothing verified. */
export const POLISH_ARTIFACT = /(^|\/)specs\/[^/]+\/(polish\.md$|polish\/)/

const SCENARIO = /\bUS\d+-AS\d+\b/g
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

/** The platforms plan.md's Target Platform names: what the app is played on. */
export function platformsFromPlan(planMd: string | null): { web: boolean; ios: boolean; android: boolean } {
  const line = /^\*\*Target Platform\*\*:\s*(.+)$/im.exec(planMd ?? '')?.[1] ?? ''
  const type = /^\*\*Project Type\*\*:\s*(.+)$/im.exec(planMd ?? '')?.[1] ?? ''
  const text = `${line} ${type}`
  return {
    web: /\b(web|browsers?|spa|website)\b/i.test(text),
    ios: /\b(iOS|iPhone|iPad)\b/i.test(text),
    android: /\bAndroid\b/i.test(text),
  }
}

/** Every acceptance scenario of the spec, in order. */
export const scenariosOf = (spec: Spec | null) => (spec?.stories ?? []).flatMap(s => s.scenarios)

/**
 * The scenarios a driver's report accepts or fails: a testcase counts for every scenario id in its name or class.
 * A scenario with any failed case fails; one with only skipped cases says nothing. Each result keeps the scenario's
 * fingerprint, so a changed scenario has to be accepted again.
 */
export function acceptanceFrom(cases: JunitCase[], spec: Spec | null, at: string, file: string): Ledger['acceptance'] {
  const texts = new Map(scenariosOf(spec).map(s => [s.id, s.text]))
  const out: Ledger['acceptance'] = {}
  for (const c of cases) {
    if (c.status === 'skipped') continue
    for (const id of new Set(`${c.name} ${c.classname}`.match(SCENARIO) ?? [])) {
      const text = texts.get(id)
      if (text === undefined) continue
      const ok = c.status === 'passed' && (out[id]?.ok ?? true)
      out[id] = { ok, fingerprint: fingerprint(text), at, file }
    }
  }
  return out
}

/** A flow that taps by screen coordinates proves nothing about its scenario (0.7.1): a Maestro `point:`, a Playwright `mouse.click(`. */
export const COORDINATE_TAP = /^\s*-?\s*point:|\bmouse\.click\s*\(/m
export const tapsByCoordinates = (flow: string) => COORDINATE_TAP.test(flow)

/** The sub-flows a Maestro flow runs (`runFlow: common/start.yaml`, or `runFlow:` with `file:`), as paths relative to the project (0.8.0, Fund 39). */
export function flowIncludes(flow: string, flowPath: string): string[] {
  const dir = flowPath.includes('/') ? flowPath.slice(0, flowPath.lastIndexOf('/')) : ''
  const out: string[] = []
  for (const m of flow.matchAll(/runFlow:\s*(?:\n\s+(?:when:[\s\S]*?\n\s+)?file:\s*)?["']?([\w./-]+\.ya?ml)["']?/g)) {
    const parts = [...(dir ? dir.split('/') : []), ...m[1]!.split('/')]
    const norm: string[] = []
    for (const p of parts) {
      if (p === '..') norm.pop()
      else if (p && p !== '.') norm.push(p)
    }
    out.push(norm.join('/'))
  }
  return [...new Set(out)]
}

/** Where a scenario stands for the person: accepted by a driver, failing there, passing unit tests only, or untested. */
export type ScenarioState = 'accepted' | 'failing' | 'stale' | 'passing' | 'untested'
export function scenarioState(id: string, text: string, ledger: Ledger): ScenarioState {
  const a = ledger.acceptance?.[id]
  if (a) {
    if (a.fingerprint !== fingerprint(text)) return 'stale'
    return a.ok ? 'accepted' : 'failing'
  }
  return ledger.verification[id]?.status === 'passing' ? 'passing' : 'untested'
}

/** acceptance.md: the evidence per scenario (a screenshot, a flow) and the list of what only a person can check. */
export function parseAcceptanceDoc(markdown: string): AcceptanceNote {
  const evidence: Record<string, { shot: string | null; flow: string | null }> = {}
  const yourPart: string[] = []
  let inYourPart = false
  for (const line of markdown.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      inYourPart = /your part|dein teil|by hand|manual/i.test(h[1]!)
      continue
    }
    if (inYourPart) {
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
      if (bullet) yourPart.push(clip(bullet[1]!.replace(/\*\*/g, '').trim(), 240))
      continue
    }
    if (!/^\s*\|/.test(line)) continue
    const id = /\bUS\d+-AS\d+\b/.exec(line)?.[0]
    if (!id) continue
    const paths = [...line.matchAll(/`?([\w./-]+\.(png|jpe?g|webp|yaml|yml|spec\.ts|test\.ts))`?/gi)].map(m => m[1]!)
    evidence[id] = { shot: paths.find(p => /\.(png|jpe?g|webp)$/i.test(p)) ?? null, flow: paths.find(p => /\.(ya?ml|ts)$/i.test(p)) ?? null }
  }
  return { evidence, yourPart }
}

/** The pane's and the dashboard's count: accepted, failing, the rest, and what is the person's. */
export function acceptanceCounts(snap: Pick<Snapshot, 'spec' | 'acceptanceDoc'>, ledger: Ledger): { total: number; accepted: number; failing: number; stale: number; yourPart: number } {
  const states = scenariosOf(snap.spec).map(s => scenarioState(s.id, s.text, ledger))
  return {
    total: states.length,
    accepted: states.filter(s => s === 'accepted').length,
    failing: states.filter(s => s === 'failing').length,
    stale: states.filter(s => s === 'stale').length,
    yourPart: snap.acceptanceDoc?.yourPart.length ?? 0,
  }
}

/** What the acceptance step hands Claude: the scenarios, the driver this machine has, the time box, the rules. */
export function acceptPrompt(snap: Snapshot): string {
  const dir = snap.featureDir ?? 'specs/<feature>'
  const p = snap.platforms ?? { web: false, ios: false, android: false }
  const web = p.web && !!snap.tools.npx
  const maestro = (p.ios || p.android) && !!snap.tools.maestro
  const scenarios = scenariosOf(snap.spec)
  // The web driver plays only where it can without downloading anything: a browser on this machine, the runner in the project.
  const webLine = !web
    ? null
    : !snap.tools.chrome
      ? 'Web: no Google Chrome is installed here, and this step never downloads a browser: the web scenarios go under Your part, with a note that Playwright needs a browser.'
      : !snap.playwright
        ? `Web: Playwright is not set up in this project yet, so play nothing on the web in this step. Append one task under '## Phase N: Acceptance setup' in ${dir}/tasks.md: add @playwright/test as a devDependency, a playwright.config.ts whose \`use\` has \`channel: 'chrome'\` (the installed Google Chrome; no browser download), and an npm script test:acceptance that writes ${ACCEPT_REPORTS}/acceptance-web.xml. The autopilot builds it, and the next acceptance run plays the scenarios.`
        : `Web first, with Playwright and the installed Google Chrome (\`channel: 'chrome'\`; never download a browser): one test file per scenario in ${ACCEPT_DIR}/<id>.spec.ts whose test title starts with the scenario id; run them with PLAYWRIGHT_JUNIT_OUTPUT_NAME=${ACCEPT_REPORTS}/acceptance-web.xml npx playwright test ${ACCEPT_DIR} --reporter=junit.`
  const drivers = [
    webLine,
    maestro
      ? `Mobile with Maestro: one flow per scenario in ${ACCEPT_DIR}/<id>.yaml with \`name: "<id> …"\`; run them with maestro test --format junit --output ${ACCEPT_REPORTS}/acceptance-mobile.xml ${ACCEPT_DIR}. Play on what the emulator or simulator already has: a development build of the app if one is installed, else Expo Go (opened on the app's exp:// link). Building a development build (npx expo run:android, run:ios) downloads native dependencies: that is no part of this step, but a task under '## Phase N: Acceptance setup' when Expo Go is not there either. Maestro cannot stub network data as Playwright does: play now what holds without live data, and for the rest append a task under '## Phase N: Acceptance setup' for a fixture mode (an environment flag that makes the app's service adapters return the fixtures the web tests use). Never leave out the mobile platform as a whole while Maestro and a device are there.`
      : null,
  ].filter((d): d is string => !!d)
  return [
    `Accept ${dir} as a person would use it, with the speckit-xref:accept skill: start the app and play each acceptance scenario of the spec through with a driver that leaves a JUnit report.`,
    `Scenarios: ${scenarios.map(s => `${s.id} "${clip(s.text, 120)}"`).join('; ') || '(the spec names none: take the quickstart rows)'}.`,
    ...(drivers.length
      ? drivers
      : ['No driver is available on this machine for these platforms: run nothing; list every scenario under Your part with the steps a person takes to check it.']),
    'Time box: about 20 minutes for bringing the app up and getting the flows to run. Then stop: keep what passed; a flow that still fails because of the flow itself goes under Your part with its manual steps. Start servers and simulators in the background and stop the ones you started at the end.',
    "Select by label, text or testID, never by screen coordinates: a tap on a point is no evidence. An element with nothing to select it by gets a task under '## Phase N: Acceptance setup' (a testID or an accessibility label), and its scenario waits for it.",
    `Do not change the app's code in this step: each scenario that fails because of the app becomes a task under '## Phase N: Acceptance fixes' in ${dir}/tasks.md (the next free T### id, the files in backticks, the scenario id), and the autopilot builds it.`,
    `Write ${acceptanceDoc(dir)}: a table (Scenario | Driver | Flow | Result | Evidence, a screenshot path) and a '## Your part' list of what only a person can check (a real device, real users, a paid service), each with its steps.`,
  ].join('\n')
}
