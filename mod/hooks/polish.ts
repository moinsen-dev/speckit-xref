// The design pass (0.9.0): a done feature that works and was tried is lifted to the look and feel of its platform's best
// apps, on the person's word. A design lead sets the direction and builds two or three sample screens, the person
// approves it at the samples, the implementer builds the rest, and the design lead reviews fresh screenshots of every
// screen (three rounds at most). Pure: workflow.ts hands the steps over, register.tsx reads polish.md.

import type { PolishNote, Snapshot, Task } from '../types'
import { tryTools } from './orchestrate'
import { fingerprint } from './rules'

export const polishDoc = (featureDir: string) => `${featureDir}/polish.md`
/** The phases a design pass writes. Not "Polish": Spec Kit's own tasks end with "Polish & Cross-Cutting Concerns". */
export const DESIGN_PHASE = /^Phase\s+\d+:\s*Design (pass|review)\b/i
export const isDesignPhase = (phase: string | null | undefined) => !!phase && DESIGN_PHASE.test(phase)
/** Review rounds of a design pass before it counts as done. */
export const MAX_DESIGN_REVIEWS = 3

/** The review rounds so far: one `Design review N` phase per round that found something. */
export const designRounds = (tasks: Task[]) => new Set(tasks.filter(t => /^Phase\s+\d+:\s*Design review\b/i.test(t.phase)).map(t => t.phase)).size

/** polish.md as the mod reads it: the direction's first line, and the fingerprint the person approves (the rounds aside). */
export function parsePolish(md: string): PolishNote {
  const head = md.split(/^##\s+Rounds\b/m)[0]!
  const lines = head.split('\n')
  const at = lines.findIndex(l => /^##\s+Direction\b/i.test(l))
  const direction = at >= 0 ? (lines.slice(at + 1).find(l => l.trim() && !l.startsWith('#'))?.trim() ?? null) : null
  return { direction, fingerprint: fingerprint(head.trim()), rounds: (md.match(/^###\s+Round\s+\d+/gm) ?? []).length }
}

/** What the best apps of each platform look and feel like today, by their conventions rather than by version. */
export const PLATFORM_LOOK = [
  'iOS: content runs edge to edge, and navigation and controls sit on translucent material that floats above it (tab bar, toolbars, floating buttons), not on opaque bars; large titles that collapse as the content scrolls; sheets with detents for secondary tasks instead of full screens; system symbols (SF Symbols) with or instead of text; Dynamic Type text styles, no fixed font sizes; semantic system colours and materials that follow light and dark mode; haptics when something is committed (saved, liked, done); springy, interruptible motion; native controls (segmented control, menu, picker, switch) over home-made ones; swipe actions and context menus where a list invites them; empty, loading and error states designed, not left to defaults.',
  'Android: Material 3 in its expressive form: dynamic colour, large shapes, motion that carries meaning, edge to edge, predictive back.',
  'Web: the same direction in CSS: backdrop-filter materials, the system font stack, prefers-color-scheme and prefers-reduced-motion, a visible focus ring.',
  'Always: one clear primary action per screen, touch targets of at least 44 pt, contrast AA, labels for VoiceOver and TalkBack, Reduce Motion and Reduce Transparency honoured.',
].join('\n')

/** How to build it: the platform's own parts, the skills that know them, and what stays out of the step. */
export const DESIGN_TOOLS =
  "Build with the platform's own components first: for Expo the expo-ui, expo-native-ui, expo-router and expo-animation skills where they are installed (native controls, materials and blur, native stack and tabs, motion); for Flutter Cupertino and Material 3; for SwiftUI the system materials and controls. Adding a package of the app's framework is fine (with the project's package manager, e.g. `npx expo install`); a change that needs a new native build (a development build, pods) becomes a task of its own with the reason, never part of this step."

/** The design lead's system prompt: the look rises, what the app does stays. */
export const DESIGNER_PROMPT = [
  'You are the design lead for an app that works and that people have tried: you lift its look and feel to the level of the best apps on its platform, without changing what it does. The speckit-xref autopilot delegates to you; your prompt says whether you set the direction or review a built design pass.',
  `What "best" means here:\n${PLATFORM_LOOK}`,
  DESIGN_TOOLS,
  'What the app does stays: the same screens, flows and the texts that carry meaning, and every test green (run the test command after each change). A test that checks only the old look may follow the new one.',
  'Only what you saw on this build counts: a "before" shot may come from the user test (specs/<feature>/try/), every "after" shot is taken now.',
  'Before each task call mcp__speckit-xref__focus with its id; a file no task names gets mcp__speckit-xref__link to the task it serves.',
  'End with a report of at most eight lines.',
].join('\n\n')

/** The design lead's first step: the direction, the tasks, two or three sample screens. The rest waits for the person. */
export function directionBrief(snap: Snapshot): string {
  const dir = snap.featureDir ?? 'specs/<feature>'
  const screens = (snap.design?.screens ?? []).map(s => s.name)
  return [
    `Set the design direction for ${dir}: the app works and was tried; now it should look and feel like the best apps on its platform. Time box: about 30 minutes.`,
    ...(screens.length ? [`Screens: ${screens.join(', ')}.`] : []),
    tryTools(snap),
    `1. Use the app and take a "before" shot of every screen, light and dark, under ${dir}/polish/before/ (a shot of this build from ${dir}/try/ will do).`,
    `2. Write ${dir}/polish.md: \`## Direction\` (its first line says the feel in one sentence; then the materials, type, colour, symbols, motion and haptics, and what stays), \`## Screens\` (per screen: what changes and with which native components), \`## Samples\` (filled in at step 4), \`## Rounds\` (empty; the reviews add to it). Bring DESIGN.md to the new direction, in its own format.`,
    `3. Before any code, append \`## Phase N: Design pass\` to ${dir}/tasks.md (the next phase number, the next free T### ids): first one task for the shared parts (theme, type, components, navigation), then one task per screen, each with its files in backticks and the story it serves.`,
    `4. Build the shared task and two or three screens that show the direction best, as samples, each under its task; check those tasks off once the tests pass. Take an "after" shot of each sample under ${dir}/polish/after/ and list before → after per sample under \`## Samples\`.`,
    '5. Leave the other screens\' tasks open: the person approves the direction at the samples first.',
    'Start servers, simulators and browsers in the background and stop the ones you started at the end.',
  ].join('\n')
}

/** The design lead's review of a built pass: fresh shots of every screen against the direction. */
export function critiqueBrief(snap: Snapshot, round: number): string {
  const dir = snap.featureDir ?? 'specs/<feature>'
  return [
    `Review round ${round} of ${MAX_DESIGN_REVIEWS}: is the built design pass of ${dir} what polish.md promises, on this build? Time box: about 20 minutes. Change no code in this step.`,
    tryTools(snap),
    `Take a fresh shot of every screen, light and dark, under ${dir}/polish/round-${round}/, and compare each with polish.md (direction and screen plan), DESIGN.md and the platform's conventions.`,
    'Rate each finding: HIGH (a screen still looks as before, or the new look breaks something: text cut off, contrast below AA, a control hidden under material, a flow that no longer works), MEDIUM (a deviation from the direction a person notices: spacing, alignment, an inconsistent component, a missing state), LOW (taste).',
    `Each HIGH or MEDIUM finding becomes a task under \`## Phase N: Design review ${round}\` in ${dir}/tasks.md (the next phase number and free T### ids, the screen, what to change, its files in backticks). Add \`### Round ${round}\` under \`## Rounds\` in polish.md: the date, per screen OK or its findings, the shot paths; LOW findings stay there.`,
    'Without a way to tap (no simulator tool, no Maestro) say which screens you only looked at and did not use. No HIGH or MEDIUM finding: say so; the design pass is then done.',
    'Start servers, simulators and browsers in the background and stop the ones you started at the end.',
  ].join('\n')
}

/** What an implement step of a design pass adds to its brief. */
export const DESIGN_PASS_RULES = [
  'This phase is a design pass: change how the app looks and feels, not what it does. Follow polish.md (direction, screen plan, samples) and DESIGN.md, and reuse the shared parts the samples introduced.',
  DESIGN_TOOLS,
  'Keep every test green; a test that checks only the old look may follow the new one. Take an "after" shot of each screen you finish, under the feature\'s polish/after/.',
].join('\n')
