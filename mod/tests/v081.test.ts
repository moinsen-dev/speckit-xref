import { expect, test } from 'claude-code/testing'

import { FRESH_START, tryBrief } from '../hooks/orchestrate'
import { parseSpec } from '../hooks/speckit'
import type { Snapshot } from '../types'
import { DEMO } from './fixtures/demo'
import { FEATURE } from './harness'

// 0.8.1: the user test starts as a new user, then tries again as a returning one (found in the first live test: Expo Go
// had the location permission already, so the dialog never showed, and an older build's data broke the app by chance).

test('the user test starts as a new user with permissions reset before the app starts, then tries again as a returning user', () => {
  const snap = { featureDir: FEATURE, spec: parseSpec(DEMO[`${FEATURE}/spec.md`]!), platforms: { web: false, ios: true, android: true } } as unknown as Snapshot
  for (const brief of [tryBrief(snap, { story: null }), tryBrief(snap, { story: 'Phase 3: User Story 1 - Request a link' })]) {
    expect(brief).toContain(FRESH_START)
  }
  expect(FRESH_START).toContain('xcrun simctl privacy <device> reset all <bundle id>')
  expect(FRESH_START).toContain('never while it runs')
  expect(FRESH_START).toContain('once more as a returning user')
})
