// Orchestration (0.8.0): the mod decides each step, its model and its brief; the heavy steps run in subagents with a
// fresh context. The main session relays: it calls the Agent tool with the mod's agent type, and the mod's spawn hook
// sets the model, the brief and the foreground run. The main context then grows by reports, not by the phase's work.
// Pure: register.tsx registers the agent types, rewrites the spawn and guards the main loop's writes.

import type { Autopilot, Snapshot, Task } from '../types'
import { LEAN_TESTS, phaseBrief, runbookNote } from './brief'
export { LEAN_TESTS }

export const IMPLEMENTER = 'implementer'
export const TESTER = 'tester'
export const DESIGNER = 'designer'
export type Models = 'auto' | 'opus' | 'sonnet' | 'haiku'
export const MODELS: Models[] = ['auto', 'sonnet', 'opus', 'haiku']
export type Delegate = { agent: typeof IMPLEMENTER | typeof TESTER | typeof DESIGNER; model: string; description: string; brief: string }


/** A task's files are all documentation or configuration: work a small model does as well. */
const MECHANICAL = /(\.(md|json|ya?ml|toml|ini|txt|env\.example)$|(^|\/)\.[\w.-]+$|(^|\/)(package|tsconfig|app|eas|babel\.config|metro\.config|eslint\.config)\b)/i

/**
 * The model for a delegated step. A fixed `models` option wins; `auto`: Sonnet builds and repairs, Opus takes over a
 * repair that failed once already, Haiku does a phase whose files are all docs or configuration; the design lead's
 * direction and reviews are Opus's (0.9.0), and a design pass is never Haiku's.
 */
export function routeModel(kind: 'implement' | 'repair' | 'try' | 'design', models: Models, opts: { repairs?: number; tasks?: Task[]; designPass?: boolean } = {}): string {
  if (models !== 'auto') return models
  if (kind === 'design') return 'opus'
  if (kind === 'repair') return (opts.repairs ?? 0) >= 2 ? 'opus' : 'sonnet'
  if (kind === 'implement') {
    const paths = (opts.tasks ?? []).flatMap(t => t.paths)
    if (!opts.designPass && paths.length && paths.every(p => MECHANICAL.test(p))) return 'haiku'
  }
  return 'sonnet'
}

/** The agent type's system prompt: one phase of tasks, the project's rules, and the record the mod keeps. */
export const IMPLEMENTER_PROMPT = [
  'You implement one phase of a GitHub Spec Kit feature, delegated by the speckit-xref autopilot. Your prompt is the phase brief: its tasks, what they must prove, the test command, the runbook.',
  'Read the spec.md and plan.md of the feature and the files the tasks name. Work through the tasks in order. Before each task call mcp__speckit-xref__focus with its id; a file no task names gets mcp__speckit-xref__link to the task it serves.',
  'Mark code that implements a requirement with a comment `@spec <feature>/FR-###`; a test carries the anchor of what it proves and the id in its name.',
  LEAN_TESTS,
  'A task that asks for a check by hand (the app on a simulator, an emulator or in a browser, screenshots against the design, a measured time) is done only when you did it now, on this code: results written down earlier (quickstart.md, notes, an older run) are no evidence. Look for the tools before you give up (the simulator and browser tools, maestro, adb, also outside PATH); when none here can do it, leave the task open, say so in your report and ask the person with mcp__speckit-xref__ask.',
  'Check a task off ([X] in tasks.md) only when its code is in place and the test command passes. Do not edit spec.md or plan.md. Decide what the brief leaves open and note it in your report; a product decision only the person can make goes to mcp__speckit-xref__ask.',
  'When you get past a problem of the environment (a port, a flag, a permission name), add one line to .specify/memory/runbook.md.',
  'End with a report of at most eight lines: tasks done, tasks left and why, the test run (passed/failed, counts), files changed, decisions you took.',
].join('\n')

/** The tester's system prompt: use the app as a person would and report what breaks. */
export const TESTER_PROMPT = [
  'You test an app the way a person uses it, delegated by the speckit-xref autopilot: not by reading code, by using the running app. Your prompt names what to try and with which tool.',
  'Follow each user story\'s goal in the app, then the paths people take by accident: a permission denied, no network, back and forth, empty or very long input, a second try. Look for crashes, dead ends, endless spinners, wrong numbers or dates, text cut off or unreadable, a screen that contradicts the spec.',
  'Take a screenshot of every finding and of each story\'s end state. Do not change the app\'s code.',
  'Rate each finding: HIGH (a story cannot be completed, data is wrong or lost, a crash), MEDIUM (a person would stumble or misread), LOW (polish).',
  'End with a report of at most ten lines: per story passed or the findings, each with its rating and screenshot path.',
].join('\n')

/** What the main session is told for a delegated step: relay it, do not do it. */
export function relayPrompt(d: Delegate): string {
  return [
    `Delegate this step; do not do its work yourself: call the Agent tool once with subagent_type "speckit-xref:${d.agent}", description "${d.description}", and the prompt "Carry out your brief." The autopilot gives the agent its brief and its model (${d.model}); it runs in the foreground, so wait for its report.`,
    d.agent === TESTER
      ? 'When it reports, write its findings as the brief says (try.md and tasks for HIGH and MEDIUM findings) if it did not, then end your turn with the report in at most five lines.'
      : 'When it reports, end your turn with its report in at most five lines. Writing code in this turn is refused: the work is the agent\'s.',
  ].join('\n')
}

/** The implementer's brief for one phase: its tasks, what to prove, how to test, what the environment taught. */
export function implementBrief(snap: Snapshot, phase: string, lastTest: Autopilot['lastTest']): string {
  const tasks = snap.tasks.filter(t => t.phase === phase && !t.done)
  const runbook = runbookNote(snap.runbook)
  return [
    `Feature: ${snap.featureDir}. Phase: ${phase}.`,
    'Tasks (tasks.md):',
    ...tasks.map(t => `- ${t.id} ${t.text}`),
    ...phaseBrief(snap, phase, lastTest),
    snap.testCommand ? `Test command: \`${snap.testCommand}\`.` : 'No test command is known: say how you checked the phase.',
    ...(runbook ? [runbook] : []),
  ].join('\n')
}

/** The implementer's brief for a failing suite. */
export function repairBrief(snap: Snapshot, output: string): string {
  return [
    `Feature: ${snap.featureDir}. The tests fail. Run \`${snap.testCommand}\`, find the cause and fix the code (not the tests, unless a test contradicts the spec). Check off no new tasks.`,
    `Last output:\n${output.slice(-1500)}`,
    ...(runbookNote(snap.runbook) ? [runbookNote(snap.runbook)!] : []),
  ].join('\n')
}

/** Where a user test runs here: the iOS Simulator tool of the desktop app, a browser, or a headless browser script. */
export function tryTools(snap: Snapshot): string {
  const p = snap.platforms ?? { web: false, ios: false, android: false }
  const lines: string[] = []
  if (p.ios) {
    lines.push('iOS: if the mcp__Claude_Code_iOS_Simulator__control tool is available, start the app (Expo: `npx expo start`, then open its exp:// URL in Expo Go with open_url, or a development build if one is installed) and use it with screenshot, tap, swipe and text.')
    // A console session has no simulator tool: simctl shows the app, and only Maestro can tap (0.9.0).
    // The samples are already in the app at the direction: light and dark are switched, not assumed (0.9.0).
    lines.push('Light and dark: `xcrun simctl ui <device> appearance light` or `dark` switches the simulator.')
    lines.push('Without that tool, on a Mac with Xcode: boot a simulator (`xcrun simctl boot <device>`), open the app\'s URL with `xcrun simctl openurl <device> <url>`, take shots with `xcrun simctl io <device> screenshot <file>` and read them with the Read tool; taps and typing need Maestro (a short flow with `maestro test`) where it is installed. Without Maestro you can only look: say which screens you saw but did not use.')
  }
  if (p.web || !lines.length) lines.push('Web: if browser tools are available (mcp__Claude_Browser__* or mcp__claude-in-chrome__*), use them on the app\'s dev server; else write a short Playwright script with `channel: \'chrome\'` (the installed Chrome; never download a browser) that clicks through like a person and saves screenshots.')
  lines.push('No tool here for a platform: that platform is the person\'s part, with the steps to try.')
  return lines.join('\n')
}

/**
 * A new user first, then a returning one (0.8.1): the first-run screens and the permission dialogs only show on an
 * empty app, and an older build's data only breaks the app of a returning user (both found in the first live test).
 */
export const FRESH_START =
  "Start as a new user: the app's stored data empty and its permissions not yet asked, so the first-run screens and the permission dialogs appear. Reset the permissions before the app starts, never while it runs (the system ends it): iOS `xcrun simctl privacy <device> reset all <bundle id>` (Expo Go: `host.exp.Exponent`), Android `adb shell pm revoke <package> <permission>`. Data an older build left (Expo Go keeps a project's data between builds) is cleared after you keep a copy. Then try once more as a returning user, with the data the first pass left; data of an older version that breaks the app is a finding."

/** The tester's brief: one story right after it is built, or the whole app at the end. */
export function tryBrief(snap: Snapshot, scope: { story: string | null }): string {
  const dir = snap.featureDir ?? 'specs/<feature>'
  const stories = (snap.spec?.stories ?? []).filter(s => !scope.story || scope.story.includes(s.id) || scope.story.includes(`User Story ${s.id.slice(2)}`))
  return [
    scope.story
      ? `Try the story just built, as a person would: ${scope.story}. Time box: about 10 minutes.`
      : `Try the whole app of ${dir} as a person would, story after story, before it counts as done. Time box: about 20 minutes.`,
    'Stories:',
    ...stories.map(s => `- ${s.id} ${s.title}${s.scenarios.length ? `: ${s.scenarios.map(x => x.text).join(' / ')}` : ''}`),
    tryTools(snap),
    FRESH_START,
    `Write ${dir}/try.md: the date, the platform and tool, per story what you did and saw, each finding with its rating and screenshot (save them under ${dir}/try/). Each HIGH or MEDIUM finding becomes a task under '## Phase N: User test fixes' in ${dir}/tasks.md (the next free T### id, the steps to reproduce, the files it likely touches in backticks, the story id); LOW ones stay in try.md.`,
    'Start servers, simulators and browsers in the background and stop the ones you started at the end.',
  ].join('\n')
}

/** Spec Kit's own files: the session still keeps them while a subagent writes the code. */
const RECORD = /^(\.\/)?(specs|\.specify)\//

/**
 * Whether a call of the main session writes code (0.8.0): the file tools on anything but the feature's record, and
 * a shell command that redirects into a file, tees, or edits in place. Reading, testing and git pass.
 */
export function writesCode(tool: string, input: Record<string, unknown>, root = ''): boolean {
  const rel = (p: string) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p)
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
    const file = rel(String(input.file_path ?? input.notebook_path ?? ''))
    return !!file && !RECORD.test(file)
  }
  if (tool !== 'Bash') return false
  const command = String(input.command ?? '')
  const targets = [...command.matchAll(/(?:^|[^\d&<>])>>?\s*([^\s;&|<>]+)/g)].map(m => m[1]!).filter(t => !/^(\/dev\/null|&\d)$/.test(t))
  if (targets.some(t => !RECORD.test(rel(t)))) return true
  return /\btee\b(?!\s+(-a\s+)?(\.\/)?(specs|\.specify)\/)|\b(?:sed|perl)\s+(?:-[a-zA-Z]*\s+)*-i\b/.test(command)
}
