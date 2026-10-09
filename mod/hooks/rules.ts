// Shared rules of docs/contract-0.4.md that both the mod and the extension implement: fingerprints, path globs,
// what never counts as drift, what a test file is, which feature a branch names, a requirement's status.

// ---- Fingerprints (§6) ----

/** The bytes of a string in UTF-8, without TextEncoder (the mod's sandbox has none). */
function utf8(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** SHA-256 of a string's UTF-8, as lower-case hex. Synchronous, so pure code can fingerprint. */
export function sha256(text: string): string {
  const bytes = utf8(text)
  const bitLength = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLength >>> (i * 8)) & 0xff)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Array<number>(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4]! << 24) | (bytes[off + i * 4 + 1]! << 16) | (bytes[off + i * 4 + 2]! << 8) | bytes[off + i * 4 + 3]!
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    ;[a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v) | 0))
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('')
}

export function normalizeText(text: string): string {
  const nfkc = typeof text.normalize === 'function' ? text.normalize('NFKC') : text
  return nfkc.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.;:!]+$/, '').trim()
}

export const fingerprint = (text: string) => sha256(normalizeText(text))

/** What the spec gate keys on: the person's words, every requirement and every scenario. */
export function specFingerprint(spec: { input: string | null; reqs: { text: string }[]; stories: { scenarios?: { text: string }[] }[] }): string {
  const parts = [spec.input ?? '', ...spec.reqs.map(r => r.text), ...spec.stories.flatMap(s => (s.scenarios ?? []).map(x => x.text))]
  return fingerprint(parts.join('\n'))
}

// ---- Path rules (§2) ----

export const DEFAULT_EXEMPT = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'go.sum', 'composer.lock', 'Podfile.lock', 'pubspec.lock',
  'node_modules/', '/dist/', '/build/', '/coverage/', '/.next/', '/out/', '/target/', '__snapshots__/', '*.min.js', '*.map', '*.generated.*', '*.g.dart',
]
export const DEFAULT_UNCLEAR = [
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pubspec.yaml', 'Gemfile', 'requirements*.txt', '*.config.*', 'tsconfig*.json', '.eslintrc*', '.prettierrc*', 'Dockerfile', 'docker-compose*.yml',
  '/.github/workflows/', '.env.example', '*.md',
]
const TEST_GLOBS = ['*.test.*', '*.spec.*', 'test_*.py', '*_test.py', '*_test.go', '*_test.dart', '/tests/', '/test/', '__tests__/']

const SPECIAL = /[\\^$.|+(){}[\]]/

export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/^\.\//, '')
  const folder = p.endsWith('/')
  if (folder) p = p.slice(0, -1)
  if (p.startsWith('/')) p = p.slice(1)
  else if (!p.includes('/')) p = `**/${p}`
  if (folder) p += '/**'
  let re = ''
  for (let i = 0; i < p.length; ) {
    if (p.startsWith('**/', i)) {
      re += '(?:.*/)?'
      i += 3
    } else if (p.startsWith('/**', i) && i + 3 === p.length) {
      re += '(?:/.*)?'
      i += 3
    } else if (p.startsWith('**', i)) {
      re += '.*'
      i += 2
    } else {
      const ch = p[i]!
      re += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : SPECIAL.test(ch) ? `\\${ch}` : ch
      i += 1
    }
  }
  return new RegExp(`^${re}$`)
}

export type Rules = { exempt: string[]; unclear: string[] }

export function parseIgnore(text: string): Rules {
  const rules: Rules = { exempt: [], unclear: [] }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const unclear = /^unclear:\s*(.+)$/.exec(line)
    if (unclear) rules.unclear.push(unclear[1]!.trim())
    else rules.exempt.push(line)
  }
  return rules
}

export function rulesFrom(ignoreText: string | null): Rules {
  const own = ignoreText ? parseIgnore(ignoreText) : { exempt: [], unclear: [] }
  return { exempt: [...DEFAULT_EXEMPT, ...own.exempt], unclear: [...DEFAULT_UNCLEAR, ...own.unclear] }
}

const compiled = new Map<string, RegExp>()
export function matchesAny(rel: string, patterns: readonly string[]): boolean {
  return patterns.some(p => {
    let re = compiled.get(p)
    if (!re) compiled.set(p, (re = globToRegExp(p)))
    return re.test(rel)
  })
}

export const isTestFile = (rel: string) => matchesAny(rel, TEST_GLOBS)
export const hasRealTests = (text: string) => /\b(?:it|test|describe)\s*\(|\bdef test_|\bfunc Test[A-Z_]|\btestWidgets\s*\(/.test(text)

// ---- Feature from the branch (§7) ----

export function featureFromBranch(branch: string, dirs: readonly string[]): string | null {
  const number = /(?:^|\/)(\d{3,})-/.exec(branch)?.[1]
  if (!number) return null
  const hits = dirs.filter(d => d.slice(d.lastIndexOf('/') + 1).startsWith(`${number}-`))
  return hits.length === 1 ? hits[0]! : null
}

// ---- Requirement status (§11) ----

export type ReqStatus = { status: 'active' | 'superseded' | 'retired'; supersededBy: string | null }

export function reqStatus(text: string): ReqStatus {
  const by = /SUPERSEDED by ((?:FR|SC)-\d{3,})/.exec(text)
  if (by) return { status: 'superseded', supersededBy: by[1]! }
  if (/RETIRED/.test(text)) return { status: 'retired', supersededBy: null }
  return { status: 'active', supersededBy: null }
}

/** The bare id of an anchor or link (`001-auth/FR-003` → `FR-003`) when it belongs to `featureDir`, else null. */
export function localId(id: string, featureDir: string | null): string | null {
  const slash = id.lastIndexOf('/')
  if (slash === -1) return id
  const feature = id.slice(0, slash)
  return featureDir && featureDir.slice(featureDir.lastIndexOf('/') + 1) === feature ? id.slice(slash + 1) : null
}
