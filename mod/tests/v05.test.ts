import { expect, test } from 'claude-code/testing'

import { parseIdeaBrief } from '../hooks/workflow'
import { DEMO } from './fixtures/demo'
import { PANE, project, runTurn, startSession, toText, type, xref } from './harness'

// 0.5.0: a new project starts at the idea. Validate researches it, the person decides, Shape settles the first version.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const BRIEF = `# Idea Brief: Daylight

**Idea**: "Ideas for a free afternoon"
**One-liner**: Three fitting ideas for your free time in three taps, for people who freeze when they have time off.
**Recommendation**: build
**Score**: 3.8 / 5
**Research**: web (9 sources)

## Who has the problem
People with free time and no plan.

## Alternatives
- [Meetup](https://www.meetup.com): group events; little for a spontaneous afternoon
- Some App (unverified): a list of activities; no weather

## What makes it different
It decides for you in seconds.

## Riskiest assumptions
1. People want to be told what to do (test: a paper prototype with five people)

## Kill criteria
- Fewer than 2 of 10 testers come back in a week

## Success measures
- 70 % of first-time users get a suggestion within 3 taps
`

/** An empty folder with Spec Kit set up for Claude, as the setup step leaves it: still empty for the mod. */
function setUp(): Record<string, string> {
  return {
    'README.md': '# idea\n',
    '.specify/memory/constitution.md': '### [PRINCIPLE_1_NAME]\n',
    '.specify/integration.json': JSON.stringify({ integration: 'claude', integration_settings: { claude: { invoke_separator: '-' } } }),
    '.claude/skills/speckit-plan/SKILL.md': '---\nname: speckit-plan\n---\n',
    '.claude/skills/speckit-implement/SKILL.md': '---\nname: speckit-implement\n---\n',
  }
}

test('the idea brief reads its verdict, score, sources and risks', () => {
  const brief = parseIdeaBrief(BRIEF)
  expect([brief.title, brief.recommendation, brief.score, brief.research]).toEqual(['Daylight', 'build', 3.8, true])
  expect(brief.alternatives).toEqual([
    { name: 'Meetup', url: 'https://www.meetup.com', note: 'group events; little for a spontaneous afternoon', verified: true },
    { name: 'Some App', url: null, note: 'a list of activities; no weather', verified: false },
  ])
  expect(brief.risks[0]).toContain('People want to be told what to do')
  expect(brief.kill).toHaveLength(1)
  expect(parseIdeaBrief(BRIEF.replace('**Research**: web (9 sources)', '**Research**: none (no web tools in this session)')).research).toBe(false)
  // The person's decision line does not change what the decision holds for.
  expect(parseIdeaBrief(BRIEF.replace('**Score**', '**Decision**: build (the person, 2026-10-10)\n**Score**')).fingerprint).toBe(brief.fingerprint)
})

test('a new project: the idea is researched, the person decides, the first version is shaped, then the constitution', async ($, on) => {
  const seen = project(on, setUp(), { answers: [] })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Describe what you want to build, in your own words: I research it first')
  await type($, 'Ideas for a free afternoon')
  await runTurn($, 'Tell me more.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('validate: The idea is known: research it before it becomes a spec.')
  expect(autopilotPrompts(seen)[0]).toContain('The idea, in the person\'s words: "Ideas for a free afternoon"')
  expect(autopilotPrompts(seen)[0]).toContain('Never invent a source')
  // Claude writes the brief; the run stops for the person's decision.
  seen.write('.specify/memory/idea-brief.md', BRIEF)
  await runTurn($, 'The brief is written: 3.8/5, recommends build.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Read the idea brief, then press Build, Sharpen or Drop')
  expect(seen.asked.at(-1)).toContain('Build it?')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('Idea: Daylight')
  expect(drawn).toContain('✓ Meetup')
  expect(drawn).toContain('? Some App')
  expect(drawn).toContain('Riskiest: People want to be told what to do')
  await pane.press({ key: 'idea-build' })
  await seen.clock.advance(0)
  expect(JSON.parse(seen.files['.specify/xref/local/project.json']!).idea.decision).toBe('build')
  expect(seen.files['.specify/memory/idea-brief.md']).toContain('**Decision**: build (the person,')
  expect(autopilotPrompts(seen)[1]).toContain('shape: Before the spec: settle with the person what the first version is')
  seen.write('.specify/memory/product-brief.md', '# Product Brief\n\n## Decisions (the person\'s)\n- Language: German only\n')
  await runTurn($)
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[2]).toContain('Run /speckit-constitution now')
  expect(autopilotPrompts(seen)[2]).toContain("the decisions in them are the person's (write them as decided, never as assumptions)")
})

test('the model cannot decide for the person: a Decision line it writes itself does not pass the gate', async ($, on) => {
  const seen = project(on, { ...setUp(), '.specify/memory/idea-brief.md': BRIEF.replace('**Score**', '**Decision**: build\n**Score**') })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)).toHaveLength(0)
  expect(seen.toasts.at(-1)).toContain('Read the idea brief, then press Build, Sharpen or Drop')
})

test('Drop ends the run; New idea moves the brief aside and asks for the next one', async ($, on) => {
  const seen = project(on, { ...setUp(), '.specify/memory/idea-brief.md': BRIEF })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'idea-drop' })
  expect(seen.toasts).toContain('Idea dropped: "Daylight". The brief stays in .specify/memory/idea-brief.md.')
  expect((await xref($, 'auto')).text).toBe('Autopilot off. /xref auto on [steps] starts it.')
  expect(toText(await pane.drawn())).toContain('[Reopen] [New idea]')
  await pane.press({ key: 'idea-new' })
  expect(seen.files['.specify/memory/idea-brief.md']).toBeUndefined()
  expect(Object.keys(seen.files).some(f => /^\.specify\/memory\/idea-brief-\d{4}-\d{2}-\d{2}-dropped\.md$/.test(f))).toBe(true)
  expect((await xref($)).text).toContain('Describe what you want to build')
})

test('existing projects and validate: off go straight on', { options: { validate: 'off', shape: 'off' } }, async ($, on) => {
  const seen = project(on, setUp())
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('Run /speckit-constitution now')
})

test('a project that already has a feature never validates', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen)[0]).toContain('implement:')
})

test('/xref web writes the dashboard; every finished step rewrites it', async ($, on) => {
  const seen = project(on, { ...DEMO })
  await startSession($)
  const answer = (await xref($, 'web')).text
  expect(answer).toContain('Dashboard written: file:///work/.specify/xref/local/dashboard.html')
  const page = seen.files['.specify/xref/local/dashboard.html']!
  expect(page).toContain('Users sign in with a one-time link sent by email. No passwords.')
  expect(page).toContain('id="req-FR-002"')
  expect(seen.files['.specify/xref/.gitignore']).toBe('local/\n')
  delete seen.files['.specify/xref/local/dashboard.html']
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect(seen.files['.specify/xref/local/dashboard.html']).toContain('Magic Link Login')
})
