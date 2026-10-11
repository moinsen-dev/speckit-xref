import { expect, test } from 'claude-code/testing'

import { NEXT_LABELS, NO_WORK, nextKindOf, treeOf, verifyKey } from '../hooks/brief'
import { railFor } from '../hooks/register'
import { RELEASE, deployToolsOf, lastRelease, parseRelease, releaseBlockers, releaseLine, releasesApp, releasesByTool, shipPrompt } from '../hooks/ship'
import { emptyLedger } from '../hooks/xref'
import { nextStep, phaseStrip, tasksFingerprint } from '../hooks/workflow'
import { parseConstitution, parseSpec, parseTasks } from '../hooks/speckit'
import { fingerprint, rulesFrom } from '../hooks/rules'
import type { Ledger, Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE, PANE, project, runTurn, startSession, toText, type, xref } from './harness'

// 0.7.0: Ship. After a done feature the person can release the app: a release check writes release.md (nothing goes
// out), its gaps become tasks, and its commands run only after the person's yes. A rail holds every deploy until then.

const autopilotPrompts = (seen: { submitted: any[] }) => seen.submitted.map(e => e.text as string).filter(t => t.startsWith('[speckit-xref autopilot'))

const DONE = DEMO[`${FEATURE}/tasks.md`]!.replace(/- \[ \]/g, '- [x]')
const DEPLOY = 'npx wrangler pages deploy dist --project-name magic-link'
const RELEASE_MD = `# Release: Magic link

**Version**: 1.0.0
**Targets**: web (Cloudflare Pages)
**Ready**: yes

## Checks

| Area | Check | Result | Evidence |
|---|---|---|---|
| Build | \`npm run build\` succeeds | pass | dist/ 412 kB |
| Secrets | no .env, *.p8 or keystore tracked | pass | git ls-files |
| Privacy | a privacy-policy URL | your part | drafted under Your part |

## Release commands

1. \`${DEPLOY}\`

## Your part

Before the release:
- [x] \`wrangler login\` once (a Cloudflare account)

After the release:
- [ ] Send the link to the first five testers

## Releases

| Date | Version | Target | Result | Where |
|---|---|---|---|---|
`
const ROW = '| 2026-10-11 | 1.0.0 | web | shipped | https://magic-link.pages.dev |\n'

test('release.md: the checks, the commands, the person\'s part before and after; the log is not part of what is approved', () => {
  const r = parseRelease(RELEASE_MD)
  expect([r.version, r.targets, r.ready]).toEqual(['1.0.0', ['web (Cloudflare Pages)'], true])
  expect(r.checks.map(c => [c.area, c.result])).toEqual([['Build', 'pass'], ['Secrets', 'pass'], ['Privacy', 'your part']])
  expect(r.commands).toEqual([DEPLOY])
  expect(r.yourPart).toEqual([
    { text: 'wrangler login once (a Cloudflare account)', done: true, when: 'before' },
    { text: 'Send the link to the first five testers', done: false, when: 'after' },
  ])
  expect(r.releases).toEqual([])
  expect(releaseLine(r)).toBe('v1.0.0 → web · 2 pass · 1 your part')
  expect(releaseLine(parseRelease('**Version**: 1.0.0 (iOS build set by EAS)\n**Targets**: web (Cloudflare Pages), ios (EAS → TestFlight)\n'))).toBe('v1.0.0 → web, ios · 0 pass')
  // Found live: the last release is all its rows, not the last one.
  const failed = parseRelease(RELEASE_MD + '| 2026-10-11 | 1.0.0 | web | failed | wrangler: not logged in |\n| 2026-10-11 | 1.0.0 | ios | failed | not run |\n')
  expect(lastRelease(failed)).toEqual({ status: 'failed', date: '2026-10-11', version: '1.0.0', line: 'web failed: wrangler: not logged in; ios failed: not run' })
  expect(lastRelease(parseRelease(RELEASE_MD + ROW))?.status).toBe('out')
  // The release appends to its log: the approval still holds. A changed command needs a new yes.
  const shipped = parseRelease(RELEASE_MD + ROW)
  expect(shipped.fingerprint).toBe(r.fingerprint)
  expect(shipped.releases).toEqual([{ date: '2026-10-11', version: '1.0.0', target: 'web', ok: true, where: 'https://magic-link.pages.dev' }])
  expect(parseRelease(RELEASE_MD.replace('magic-link\`', 'magic-link-2\`')).fingerprint).not.toBe(r.fingerprint)
  // Commands in a fenced block, a failing check, not ready.
  const other = parseRelease('**Ready**: no — the store icon is missing\n\n## Checks\n| Area | Check | Result | Evidence |\n|---|---|---|---|\n| Store | ios.bundleIdentifier | fail → T070 | app.json |\n\n## Release commands\n```bash\nnpx expo export -p web\n# comment\neas build -p ios --profile production\n```\n')
  expect([other.ready, other.readyNote]).toEqual([false, 'the store icon is missing'])
  expect(other.checks[0]!.result).toBe('fail')
  expect(other.commands).toEqual(['npx expo export -p web', 'eas build -p ios --profile production'])
  expect(deployToolsOf('{"devDependencies":{"wrangler":"^4","eas-cli":"^16"}}')).toEqual(['eas', 'wrangler'])
  expect(deployToolsOf(null)).toEqual([])
})

test('what the release check writes and builds does not change what was verified', () => {
  const base = '100644 blob a1\tsrc/auth/token.ts'
  expect(treeOf(`${base}\nh1 .specify/memory/release.md\nh2 dist/index.html\nh3 web-build/app.js`)).toBe(treeOf(base))
  expect(treeOf(`${base}\nh4 src/dist/helper.ts`)).not.toBe(treeOf(base))
})

test('the rail: deploys, store builds, submits and publishes wait for the person; building and reading pass', () => {
  for (const command of [
    DEPLOY,
    'wrangler deploy',
    'npx eas-cli@latest build -p ios --profile production --non-interactive --auto-submit',
    'eas submit -p android --latest',
    'eas update --branch production',
    'cd web && vercel --prod',
    'vercel',
    'netlify deploy --prod --dir dist',
    'firebase deploy --only hosting',
    'bundle exec fastlane ios beta',
    'npm publish',
    'npm run deploy',
    'pnpm run release',
    'yarn deploy:staging',
    'gh release create v1.0.0',
    'fly deploy',
    'supabase functions deploy',
    'docker push ghcr.io/x/app:1.0.0',
  ]) {
    expect([command, releasesApp(command)]).toEqual([command, true])
  }
  // Found live: a word in argument position is no command.
  for (const command of ['ls wrangler* vercel.json netlify.toml firebase.json fastlane 2>&1 | head', 'which fastlane vercel', 'echo vercel']) {
    expect([command, releasesApp(command)]).toEqual([command, false])
  }
  // Asking for help is no release; a release after it still is.
  expect(releasesApp('wrangler pages deploy --help')).toBe(false)
  expect(releasesApp('eas build -h')).toBe(false)
  expect(releasesApp('wrangler pages deploy --help && wrangler pages deploy dist')).toBe(true)
  for (const command of ['VERCEL_ORG_ID=x vercel deploy', '(cd web; vercel --prod)', 'npx vercel@39 --prod', 'cd ios && fastlane beta']) {
    expect([command, releasesApp(command)]).toEqual([command, true])
  }
  for (const command of ['npx expo export -p web', 'eas whoami', 'eas build:configure', 'npm run build', 'cat vercel.json', 'cat fastlane/Fastfile', 'npx vercel dev', 'wrangler pages dev dist', 'git status', 'npm test']) {
    expect([command, releasesApp(command)]).toEqual([command, false])
  }
  expect(releasesByTool('mcp__cloudflare__workers_deploy')).toBe(true)
  expect(releasesByTool('mcp__expo__submit_build')).toBe(true)
  expect(releasesByTool('mcp__cloudflare__list_deployments')).toBe(false)
  expect(releasesByTool('mcp__github__get_release')).toBe(false)
  expect(releasesByTool('Bash')).toBe(false)
  expect(railFor('Bash', { command: DEPLOY })).toBe("releasing the app (a deploy, a store build or submission, a publish) is the person's call")
  expect(railFor('mcp__expo__submit_build', {})).toContain('releasing the app')
  // A push stays a push: allowPush never opens a release.
  expect(railFor('Bash', { command: 'git push origin 001-x' })).toBe("pushing is the person's call")
})

test('the person\'s words after a done feature: ship it is its own kind, a question stays a question', () => {
  expect(NEXT_LABELS).toContain('ship it: release what is done to its users (deploy, app stores)')
  expect(nextKindOf('ship it: release what is done to its users (deploy, app stores)')).toBe('ship')
  expect(nextKindOf(NO_WORK)).toBe(null)
  expect(nextKindOf('a bug: something the finished feature does wrong')).toBe('bug')
})

function doneSnap(extra: Partial<Snapshot> = {}): Snapshot {
  const tasks = parseTasks(DONE)
  return {
    initialized: true, featureDir: FEATURE, features: [FEATURE], hasPlan: true, extensions: [], claudeIntegration: true, speckitVersion: '1.1.2',
    tools: { specify: true, uvx: true, npx: true, deploy: ['wrangler'] }, folder: 'existing', spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), tasks,
    constitution: parseConstitution(DEMO['.specify/memory/constitution.md']!), commandStyle: 'skills', rules: rulesFrom(null), realTests: [],
    planFingerprint: 'p', testCommand: null, branch: null, phase: null, tasksFingerprint: tasksFingerprint(tasks), commands: ['converge'],
    checklists: [], persistence: 'flow-back', tree: treeOf('a'), ui: false, platforms: { web: true, ios: false, android: false }, ...extra,
  } as unknown as Snapshot
}

test('ship from a done feature: the check, its blockers, the person\'s yes, the release, then done again', () => {
  const snap = doneSnap()
  const key = verifyKey(snap, tasksFingerprint(snap.tasks))
  const done: Ledger = { ...emptyLedger(), checkpoints: { converge: tasksFingerprint(snap.tasks), verify: key } }
  const flow = { review: 'none' as const, next: { kind: 'ship' as const, text: 'Ship it' } }
  expect(nextStep(snap, done, null, { review: 'none' }).phase).toBe('done')
  const check = nextStep(snap, done, null, flow)
  expect([check.phase, check.approve, check.needsUser]).toEqual(['ship', { key: 'ship', value: key }, null])
  expect(check.prompt).toContain('speckit-xref:ship skill')
  expect(check.prompt).toContain('Nothing goes out in this step')
  expect(check.prompt).toContain('Deploy tools on this machine: wrangler')
  expect(check.prompt).toContain('Never run npx with a package the project does not have')
  expect(check.prompt).toContain("'## Phase N: Release readiness'")
  expect(phaseStrip(snap, check)).toBe('✓setup ✓const ✓spec ✓plan ✓tasks ✓impl ✓verify ▶ship')
  // Checked, but nothing written: the release waits.
  const checked: Ledger = { ...done, checkpoints: { ...done.checkpoints, ship: key } }
  const empty = nextStep(snap, checked, null, flow)
  expect([empty.phase, empty.needsUser]).toEqual(['ship', `Before the release: the release check wrote no ${RELEASE}. Tick your part in ${RELEASE} as you do it; Check again in the pane runs the release check once more.`])
  // Written and clean: the person's yes.
  const release = parseRelease(RELEASE_MD)
  const ready = doneSnap({ release })
  const gate = nextStep(ready, checked, null, flow)
  expect([gate.phase, gate.approve]).toEqual(['review', { key: 'release', value: release.fingerprint }])
  expect(gate.why).toBe('The release check is written: v1.0.0 → web · 2 pass · 1 your part.')
  expect(phaseStrip(ready, gate)).toContain('▶ship')
  // Approved: the release step, once.
  const approved: Ledger = { ...checked, approvals: { release: release.fingerprint } }
  const go = nextStep(ready, approved, null, flow)
  expect([go.phase, go.consumes, go.approve]).toEqual(['release', true, { key: 'released', value: release.fingerprint }])
  expect(go.prompt).toContain(`1. \`${DEPLOY}\``)
  expect(go.prompt).toContain('stop there and do not work around it')
  expect(go.prompt).toContain("append a row to '## Releases'")
  expect(nextStep(ready, { ...approved, checkpoints: { ...approved.checkpoints, released: release.fingerprint } }, null, { review: 'none' }).phase).toBe('done')
  // A changed tree means a new check: the old one does not hold.
  expect(nextStep(doneSnap({ release, tree: treeOf('b') }), { ...checked, checkpoints: { ...checked.checkpoints, verify: verifyKey(doneSnap({ tree: treeOf('b') }), tasksFingerprint(snap.tasks)) } }, null, flow).phase).toBe('ship')
})

test('what holds a release: the proof first, then what release.md says; the person\'s part after the release holds nothing', () => {
  const release = parseRelease(RELEASE_MD)
  const snap = doneSnap({ release })
  expect(releaseBlockers(snap, emptyLedger(), { ok: true }, true)).toEqual([])
  expect(releaseBlockers(snap, emptyLedger(), { ok: false }, false)).toEqual(['the tests fail'])
  const open = parseRelease(RELEASE_MD.replace('- [x] `wrangler login`', '- [ ] `wrangler login`').replace('| pass | git ls-files |', '| fail → T070 | git ls-files |').replace('**Ready**: yes', '**Ready**: no — a store icon is missing'))
  expect(releaseBlockers(doneSnap({ release: open }), emptyLedger(), null, false)).toEqual([
    `${RELEASE} says it is not ready: a store icon is missing`,
    '1 check fails (no .env, *.p8 or keystore tracked)',
    'your part before the release: wrangler login once (a Cloudflare account)',
  ])
  const failing = { ...emptyLedger(), acceptance: { 'US1-AS1': { ok: false, fingerprint: fingerprint('x'), at: '', file: '' } } }
  expect(releaseBlockers(doneSnap({ release, spec: { ...snap.spec!, stories: [{ id: 'US1', title: 't', priority: null, scenarios: [{ id: 'US1-AS1', text: 'x' }] }] } }), failing, null, false)).toEqual(['1 acceptance scenario fails'])
  expect(releaseBlockers(doneSnap({ release: parseRelease('**Ready**: yes\n') }), emptyLedger(), null, false)).toEqual([`${RELEASE} names no release command`])
  // The check never plans with a tool it would have to download.
  expect(shipPrompt(doneSnap({ tools: { specify: true, uvx: true } } as Partial<Snapshot>))).toContain('Deploy tools on this machine: none')
  expect(shipPrompt(doneSnap({ testCommand: 'npm test' }))).toContain('The mod ran the test suite (`npm test`) right before this step and stops on a failure: do not run it again.')
  expect(shipPrompt(doneSnap())).not.toContain('right before this step')
})

test('Ship live: the check, the pane\'s Ship it, the release through the rail, then the run ends with what went out', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  expect((await xref($, 'ship')).text).toBe('The feature is not done yet: the autopilot finishes it first (/xref auto on).')
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot done:')
  const before = seen.testRuns.length
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('[New feature] [Change] [Bug] [Ship]')
  await pane.press({ key: 'next-ship' })
  expect(seen.toasts).toContain(`Ship: the release check runs first (${RELEASE}); nothing goes out without your yes.`)
  await seen.clock.advance(0)
  // The check starts from a green suite.
  expect(seen.testRuns.length).toBe(before + 1)
  expect(autopilotPrompts(seen).at(-1)).toContain(`ship: ${FEATURE} is done: check that the app is ready to release; nothing goes out in this step.`)
  // Nothing goes out in the check: the rail holds the deploy.
  const deploy = { tool: 'Bash', input: { command: DEPLOY } }
  expect((await $.tool.check(deploy as never)).decision).toBe('deny')
  seen.write(RELEASE, RELEASE_MD)
  await runTurn($, 'The release check is written.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain(`Autopilot waits for you: Read ${RELEASE}: its release commands go out only with your yes.`)
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('Shipv1.0.0 → web · 2 pass · 1 your part')
  expect(drawn).toContain('[Ship it] [Check again]')
  expect(drawn).toContain(`$ ${DEPLOY}`)
  expect(drawn).toContain('after: Send the link to the first five testers')
  await pane.press({ key: 'approve' })
  await seen.clock.advance(0)
  const go = autopilotPrompts(seen).at(-1)!
  expect(go).toContain('release: You approved the release: v1.0.0 → web · 2 pass')
  expect(go).toContain(`1. \`${DEPLOY}\``)
  // The yes holds for the release step: both commands of a two-step release go through.
  expect((await $.tool.check(deploy as never)).decision).not.toBe('deny')
  expect((await $.tool.check(deploy as never)).decision).not.toBe('deny')
  seen.write(RELEASE, RELEASE_MD + ROW)
  await runTurn($, 'Released.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toBe(`Release out: 1.0.0 → web out: https://magic-link.pages.dev (${RELEASE}).`)
  // After the release the yes is spent: a new run holds the deploy again.
  await xref($, 'auto on')
  await seen.clock.advance(0)
  expect((await $.tool.check(deploy as never)).decision).toBe('deny')
  expect(toText(await pane.drawn())).toContain('last: out 2026-10-11')
  await xref($, 'web')
  const html = seen.files['.specify/xref/local/dashboard.html']!
  expect(html).toContain('<a href="#release">Release</a>')
  expect(html).toContain(`<h3>Runs on your yes</h3>\n<ul><li><code>${DEPLOY}</code></li></ul>`)
  expect(html).toContain('<td><span class="rung r-accepted">✓ out</span></td><td>https://magic-link.pages.dev</td>')
})

test('a release that waits on the person: the pane lists why; Check again runs the check anew', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  expect((await xref($, 'next ship')).text).toBe(`Ship: the release check runs first (${RELEASE}); nothing goes out without your yes.`)
  await seen.clock.advance(0)
  seen.write(RELEASE, RELEASE_MD.replace('- [x] `wrangler login`', '- [ ] `wrangler login`'))
  await runTurn($, 'Written.')
  await seen.clock.advance(0)
  expect(seen.toasts.at(-1)).toContain('Autopilot waits for you: Before the release: your part before the release: wrangler login once (a Cloudflare account).')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = toText(await pane.drawn())
  expect(drawn).toContain('The release waits:')
  expect(drawn).toContain('· your part before the release: wrangler login once (a Cloudflare account)')
  const checks = autopilotPrompts(seen).filter(p => p.includes('] ship:')).length
  await pane.press({ key: 'ship-check' })
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).filter(p => p.includes('] ship:')).length).toBe(checks + 1)
})

test('a gap the check finds is built first: a readiness task reopens the feature', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'ship')
  await seen.clock.advance(0)
  seen.write(`${FEATURE}/tasks.md`, `${DONE}\n## Phase 9: Release readiness\n\n- [ ] T090 Add a privacy-policy link to the footer in \`src/app.tsx\`\n`)
  seen.write(RELEASE, RELEASE_MD.replace('**Ready**: yes', '**Ready**: no — T090 first'))
  await runTurn($, 'One readiness task.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('implement:')
  expect(autopilotPrompts(seen).at(-1)).toContain('T090')
})

test('"ship it" in the person\'s words at a done feature: a release, its check handed over when the turn ends', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, classify: 'ship it: release what is done to its users (deploy, app stores)' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await type($, 'Ship it to the web')
  expect(seen.submitted.at(-1).context.join('\n')).toContain("takes these words as a release (a release check first; nothing goes out without the person's yes)")
  await runTurn($, 'Noted.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('ship: specs/001-magic-link-login is done: check that the app is ready to release')
})

test('a release\'s yes holds for its step only: stopped mid-release and started again, the deploy waits again', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] } })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'ship')
  await seen.clock.advance(0)
  seen.write(RELEASE, RELEASE_MD)
  await runTurn($, 'Written.')
  await seen.clock.advance(0)
  await xref($, 'approve')
  await seen.clock.advance(0)
  const deploy = { tool: 'Bash', input: { command: DEPLOY } }
  expect((await $.tool.check(deploy as never)).decision).not.toBe('deny')
  await xref($, 'auto off')
  await xref($, 'auto on')
  expect((await $.tool.check(deploy as never)).decision).toBe('deny')
})

test('a release under way holds across sessions: the gate comes back without a new check; released or put aside, the feature is done', () => {
  const release = parseRelease(RELEASE_MD)
  const snap = doneSnap({ release })
  const key = verifyKey(snap, tasksFingerprint(snap.tasks))
  const checked: Ledger = { ...emptyLedger(), checkpoints: { converge: tasksFingerprint(snap.tasks), verify: key, ship: key } }
  // A new session: no words, no button, the ledger alone.
  expect(nextStep(snap, checked, null, { review: 'none' }).approve?.key).toBe('release')
  expect(nextStep(snap, { ...checked, checkpoints: { ...checked.checkpoints, released: release.fingerprint } }, null, { review: 'none' }).phase).toBe('done')
  // A check for another tree is no release under way.
  expect(nextStep(snap, { ...checked, checkpoints: { ...checked.checkpoints, ship: 'older' } }, null, { review: 'none' }).phase).toBe('done')
  // Other work the person names wins over the release.
  expect(nextStep(snap, checked, null, { review: 'none', next: { kind: 'bug', text: 'The link is blank' } }).phase).toBe('bug')
})

test('at the release gate: Not now puts it aside; /xref next names other work and puts it aside too', async ($, on) => {
  const seen = project(on, { ...DEMO, [`${FEATURE}/tasks.md`]: DONE }, { tests: { exits: [0] }, classify: 'a new feature, separate from the finished one' })
  await startSession($)
  await xref($, 'auto on')
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await runTurn($)
  await seen.clock.advance(0)
  await xref($, 'ship')
  await seen.clock.advance(0)
  seen.write(RELEASE, RELEASE_MD)
  await runTurn($, 'Written.')
  await seen.clock.advance(0)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(toText(await pane.drawn())).toContain('[Ship it] [Check again] [Not now]')
  await pane.press({ key: 'ship-later' })
  expect(seen.toasts).toContain('The release is put aside; Ship checks again when you want it.')
  expect(toText(await pane.drawn())).toContain('[Ship]')
  // Again at the gate, then other work by command.
  await xref($, 'ship')
  await seen.clock.advance(0)
  await runTurn($, 'Written.')
  await seen.clock.advance(0)
  expect((await xref($, 'next feature Passkeys')).text).toBe('Next: a new feature: "Passkeys". The autopilot takes it from here.')
  await seen.clock.advance(0)
  expect(autopilotPrompts(seen).at(-1)).toContain('Passkeys')
})
