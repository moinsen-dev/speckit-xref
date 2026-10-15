// The deputy (0.10.0): the autopilot thinks between its steps the way the person would. After each heavy step it
// reviews the work like a lead who reads the report and the diff (go on, send it back with a list, or ask the person),
// it answers the questions Claude asks from the spec, the briefs and the person's own earlier words, and it says what
// it decided and why. The workflow stays the frame; the deputy never approves a gate. Pure: register.tsx calls it.

import type { Snapshot, Task } from '../types'

/** The person's profile, learned from their own words only: local, like their prompts, never committed. */
export const PROFILE = '.specify/xref/local/person.md'
/** The steps whose work the deputy reviews: the ones that build, repair, try or restyle the app. */
export const REVIEWED = new Set(['implement', 'repair', 'rework', 'try', 'polish', 'bug'])
/** Send-backs of one step before it becomes the person's call. */
export const MAX_REWORKS = 2

export type Verdict = {
  verdict: 'go' | 'rework' | 'ask'
  /** For the next step: what to watch, in a line or two; empty when there is nothing to say. */
  note: string
  /** What the step has to fix before it counts (rework). */
  rework: string[]
  /** The person's question and the deputy's recommendation (ask). */
  question: string
  recommendation: string
  /** What the person said that is worth keeping about how they work (from their own words only). */
  profile: string[]
}

export type Answer = { decided: true; answer: string; why: string } | { decided: false; question: string; recommendation: string }

/** What only the person decides, whatever the deputy thinks: checked in code, not left to the prompt. */
const PERSON_ONLY = /\b(passwords?|credentials?|api[- ]keys?|secrets?|payments?|purchases?|billing|subscriptions?|wipe|force[- ]push|publish(ing)?|releases?|deploy(ing|ment)?|approv\w*|real (users?|devices?|data)|measur\w*|by hand|manually|passw(ort|örter)|zugangsdaten|api-schlüssel|zahlung\w*|bezahl\w*|kauf\w*|abonnement\w*|lösch\w*|veröffentlich\w*|freigabe\w*|freigeben|messung\w*|messen|von hand|manuell\w*|echte[nrs]? (nutzer\w*|geräte?\w*|daten)|smoke[- ]?tests?|simulator|emulator|on (a|the) (real )?device|check(ed)? by hand)\b|\b(delete|drop)\b/i

/** A question the deputy may not answer for the person, whatever the model says. */
export const personOnly = (question: string) => PERSON_ONLY.test(question)

/** The deputy's system prompt: the person's stand-in, with the person's limits. */
export const DEPUTY_PROMPT = [
  'You stand in for the person who owns this product while an autopilot builds it with GitHub Spec Kit. You are their deputy between the steps: you read what each step did the way they would, critically and with their goals in mind, and you decide what they would decide. You are thorough, not quick: read the report, the diff and the test run before you judge.',
  'Your sources, in this order: the person\'s own words and earlier decisions, their profile, the spec and its requirements, the constitution, the plan. Where they settle a question, decide it; where they do not, decide what serves the spec and record it, unless the question is one only the person can answer.',
  'Only the person decides: approvals of the spec, the plan, a design direction or a release; anything that costs money, needs credentials or an account, deletes or publishes something, or cannot be undone; a check by hand or a measurement on real users, data or devices; a matter of taste where the person never gave a direction; a conflict between their words and the spec.',
  'Answer with one JSON object and nothing else.',
].join('\n\n')

/** What a step review sees: what was asked, what came back, what changed, whether it holds. */
export type ReviewInput = {
  feature: string
  phase: string
  why: string
  /** The step's report: the subagent's whole report where it ran in one, else the session's answer. */
  report: string
  /** Every file changed since the step started, from git: the diff may be cut, this list is whole. */
  files: string[]
  diff: string
  tests: { ok: boolean; output: string } | null
  checked: string[]
  open: string[]
  requirements: string[]
  profile: string | null
  /** The person's own recent words and decisions, newest last. */
  words: string[]
  decisions: string[]
  principles: string[]
  /** The step finished a phase or the feature: look ahead too. */
  boundary: boolean
  reworks: number
  /** Option tests (0.11.0): without a suite a missing test is no reason to send a step back. */
  testMode?: 'off' | 'run' | 'lean'
}

const section = (title: string, lines: string[] | string | null) => {
  const body = Array.isArray(lines) ? lines.filter(Boolean).join('\n') : (lines ?? '').trim()
  return body ? `## ${title}\n${body}` : ''
}

/** The review request: the evidence, then the questions a lead asks, then the answer's shape. */
export function reviewRequest(i: ReviewInput): string {
  return [
    `Feature ${i.feature}. The step just done: ${i.phase} (${i.why}).${i.reworks ? ` It was sent back ${i.reworks} time${i.reworks === 1 ? '' : 's'} already.` : ''}`,
    section('Report of the step', i.report.slice(-8000)),
    section('Files changed since the step started (from git; the diff below may be cut, this list is whole)', i.files.slice(0, 80)),
    section('Diff of the step', i.diff),
    section('Test run', i.tests ? `${i.tests.ok ? 'passed' : 'FAILED'}\n${i.tests.output.slice(-1500)}` : 'not run'),
    section('Tasks checked in this step', i.checked.join(', ') || 'none'),
    section('Tasks still open', i.open.slice(0, 12)),
    section('Requirements these tasks serve', i.requirements.slice(0, 20)),
    section("The person's profile", i.profile),
    section("The person's own words, newest last", i.words.slice(-8)),
    section('Decisions so far', i.decisions.slice(-8)),
    section('Constitution', i.principles.slice(0, 12)),
    [
      '## Judge it as the person would',
      '- Does the work do what the tasks and requirements say, or does the report claim more than the diff and the test run show?',
      '- Evidence: is anything checked off on results written earlier, on a test that was weakened or skipped, or on "should work"? A check by hand or a measurement counts only when done now; one no tool here can do is the person\'s part and stays open, which is no reason to send the step back.',
      '- Scope: work no task asked for, a decision taken that the spec or the person left open, a deviation from the plan or a contract, a TODO or a stub left behind.',
      '- Anything the report says is left open or unsure: is that fine to carry on with, or does it block?',
      '- A file the report names that is in the file list but not in the diff was cut from the diff for length: that is no reason to send the step back. Send a step back only for what the evidence shows is missing or wrong.',
      ...(i.testMode === 'off' ? ['- This project runs without a test suite on purpose (option tests: off): the type check is its gate. A missing test is no reason to send a step back; a test written anyway is work nobody asked for.'] : i.testMode === 'run' ? ['- This project adds no new tests (option tests: run): the existing suite is the gate. A missing new test is no reason to send a step back.'] : []),
      ...(i.boundary ? ['- This step ended a phase or the feature: are we still building the right thing? Does anything the step or a user test found change what should come next, or need the person?'] : []),
      '',
      'verdict "go": the step holds; "note" is what the next step should keep in mind (empty if nothing). verdict "rework": it does not hold; "rework" lists what to fix, concretely, each with the file or task. verdict "ask": only the person can settle what blocks; "question" asks it in one or two sentences, "recommendation" says what you would choose and why.',
      '"profile": at most three short lines about how the person works or what they want, only where their own words above show it and the profile does not say it yet; else [].',
      'Answer: {"verdict": "go|rework|ask", "note": "", "rework": [], "question": "", "recommendation": "", "profile": []}',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** What an answer to Claude's question sees. */
export type AnswerInput = {
  feature: string
  question: string
  /** The answer it ends, or the agent's context for the ask. */
  context: string
  options: string[]
  spec: string[]
  profile: string | null
  words: string[]
  decisions: string[]
  principles: string[]
  brief: string | null
}

export function answerRequest(i: AnswerInput): string {
  return [
    `Feature ${i.feature}. Claude asks the person, mid-run: "${i.question}"${i.options.length ? ` Options: ${i.options.join(' | ')}.` : ''}`,
    section('What Claude said before the question', i.context.slice(-3000)),
    section('Spec (requirements and assumptions)', i.spec.slice(0, 40)),
    section('Product brief', i.brief),
    section("The person's profile", i.profile),
    section("The person's own words, newest last", i.words.slice(-8)),
    section('Decisions so far', i.decisions.slice(-8)),
    section('Constitution', i.principles.slice(0, 12)),
    [
      '## Answer it as the person would',
      'Decide it yourself where the sources settle it or a sound default serves the spec; say why in one sentence, naming the source. Leave it to the person only where it is theirs alone (see your instructions), and then say what you would recommend.',
      'A question that only asks whether to go on is answered "yes, go on".',
      'Answer: {"decided": true, "answer": "", "why": ""} or {"decided": false, "question": "", "recommendation": ""}',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The first JSON object in a reply, or null. */
function jsonOf(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
const strOf = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const listOf = (v: unknown, n: number, max = 300) => (Array.isArray(v) ? v.map(x => strOf(x, max)).filter(Boolean).slice(0, n) : [])

/** The review's verdict, or null when the reply is none (the autopilot then goes on as without a deputy). */
export function parseVerdict(text: string): Verdict | null {
  const j = jsonOf(text)
  if (!j || !['go', 'rework', 'ask'].includes(String(j.verdict))) return null
  const v: Verdict = {
    verdict: j.verdict as Verdict['verdict'],
    note: strOf(j.note, 400),
    rework: listOf(j.rework, 8),
    question: strOf(j.question, 400),
    recommendation: strOf(j.recommendation, 400),
    profile: listOf(j.profile, 3, 160),
  }
  // A send-back without a list, or a question without one, is no verdict to act on.
  if (v.verdict === 'rework' && !v.rework.length) return { ...v, verdict: 'go' }
  if (v.verdict === 'ask' && !v.question) return { ...v, verdict: 'go' }
  return v
}

/** The answer to a question, or null when the reply is none. What only the person decides stays theirs, in code. */
export function parseAnswer(text: string, question: string): Answer | null {
  const j = jsonOf(text)
  if (!j || typeof j.decided !== 'boolean') return null
  if (j.decided && strOf(j.answer) && !personOnly(question)) return { decided: true, answer: strOf(j.answer, 500), why: strOf(j.why, 300) }
  return { decided: false, question: strOf(j.question, 400) || question, recommendation: strOf(j.recommendation, 400) }
}

/** The send-back's brief: the step again, with the deputy's list first. */
export function reworkBrief(feature: string, phase: string, items: string[], report: string): string {
  return [
    `Feature: ${feature}. The person's deputy reviewed the last ${phase} step and sends it back. Fix these, then run the tests:`,
    ...items.map(x => `- ${x}`),
    'Uncheck a task in tasks.md whose work is not done after all; check nothing new off. A point you cannot fix here (no tool, a decision only the person can make) stays open: say so in your report.',
    `The step's report was:\n${report.slice(-1500)}`,
  ].join('\n')
}

/** The note the next step carries: the deputy's word on the last one. */
export const noteLine = (note: string) => `The person's deputy on the last step: ${note}`

/** What the deputy decided, as the next step reads it. */
export const answerLine = (question: string, answer: string, why: string) => `The person's deputy answered your question "${question.slice(0, 200)}": ${answer}${why ? ` (${why})` : ''}. Go on with it.`

/** The requirements a step's tasks serve, as the review reads them. */
export function requirementsOf(snap: Snapshot, tasks: Task[]): string[] {
  const ids = new Set(tasks.flatMap(t => t.reqs))
  return (snap.spec?.reqs ?? []).filter(r => ids.has(r.id)).map(r => `${r.id}: ${r.text}`)
}

/** Lines of the profile to add: new ones only. */
export function profileAdditions(current: string | null, lines: string[]): string[] {
  const have = (current ?? '').toLowerCase()
  return lines.filter(l => l && !have.includes(l.toLowerCase()))
}
