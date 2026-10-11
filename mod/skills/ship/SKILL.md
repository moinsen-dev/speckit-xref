---
name: ship
description: Check that a finished Spec Kit app is ready to release and plan the release - version and store fields, OS permission texts, privacy, accessibility, secrets, the production build - and write .specify/memory/release.md with the checks, the exact release commands per platform (web hosting, Expo EAS for iOS and Android) and what only the person can do. Nothing goes out in the check; the release commands run only after the person's yes. Use when the speckit-xref autopilot hands over a ship or release step, or before releasing a feature built with Spec Kit.
---

# Ship an app

The features are built, verified and played through. Releasing is different work: the app reaches people, through a host or a store, under the person's accounts and names. This step checks that it is ready and writes down exactly how it goes out. **Nothing goes out in the check**: no deploy, no store build, no submit, no publish, no push. The person reads `.specify/memory/release.md` and says yes; only then do its release commands run, once.

## 1. What to read

- `plan.md` of the features (Target Platform, Project Type), `package.json`, `app.json` / `app.config.*`, `eas.json`, the host's configuration if there is one (`wrangler.toml` / `wrangler.jsonc`, `vercel.json`, `netlify.toml`, `firebase.json`, `fly.toml`, `fastlane/`), `.env.example`, `.gitignore`.
- `.specify/memory/runbook.md` (what earlier steps learned about this environment), each feature's `acceptance.md` (its Your part), and with a PRD `.specify/memory/roadmap.md` (the gates are the person's).
- An earlier `.specify/memory/release.md`: keep its `## Releases` log as it is and rewrite the rest.

## 2. The checks

One table row per check, with the evidence (a file, a command and what it printed, a size). Look, do not assume:

- **Build**: the production build runs locally where it needs no account, e.g. `npx expo export -p web`, `npm run build`. Note the output folder and its size. A build that fails is a finding.
- **Version**: the version and the build numbers (`expo.version`, `ios.buildNumber`, `android.versionCode`, or `autoIncrement` in the EAS production profile).
- **Store** (iOS, Android): app name, `ios.bundleIdentifier`, `android.package`, icon and adaptive icon, splash.
- **Permissions**: every OS permission the code asks for (location, camera, microphone, photos, notifications, tracking) has its usage text (`ios.infoPlist` `NS…UsageDescription`, or the plugin's option such as `locationWhenInUsePermission`); Android permissions are listed and none is requested that the code does not use.
- **Privacy**: what leaves the device and where to; a privacy-policy URL. Draft the stores' privacy answers (App Store privacy labels, Google Play data safety) from the code under Your part: the person answers them.
- **Accessibility**: labels on icon-only controls, text that scales, the contrast of `DESIGN.md`'s colours (4.5:1 for text).
- **Secrets**: no `.env`, `*.p8`, `*.p12`, `*.jks`/keystore or service-account file is tracked (`git ls-files`); they are in `.gitignore`; `.env.example` names every variable the code reads. **Name paths, never values**, in release.md and in your answer.
- **Errors**: what a person sees offline and when a service fails.

**Never download to check.** Run only what the project and this machine already have: no `npx` of a package that is not in `package.json` (`eas-cli`, `wrangler`, `lighthouse`, `serve` …), no browser download. A check that needs a missing tool is the person's part, or a setup task.

## 3. Findings

Rate each one: **HIGH** (blocks the release or breaks a store rule: a missing bundle identifier, a permission without its text, a tracked secret, a failing build), **MEDIUM** (a user or a reviewer would hit it), **LOW** (polish). HIGH and MEDIUM findings that are code or configuration work become tasks under `## Phase N: Release readiness` in the active feature's `tasks.md` (the next free T### ids, the files in backticks); the autopilot builds, verifies and plays them through, then checks again. Name the LOW ones in your answer under `Low, no task`. **Do not change the app in this step.**

## 4. The release, per platform

Write the exact commands, in order, with the tools that are here; the person approves them as written.

**Web (a static export)**: the build (`npx expo export -p web` → `dist/`, or the project's build script), then the host the project is set up for:
- `wrangler.toml` / `wrangler.jsonc` → `npx wrangler pages deploy dist --project-name <name>` (with `wrangler` in the project or on PATH)
- `vercel.json` → `vercel deploy --prod`; `netlify.toml` → `netlify deploy --prod --dir dist`; `firebase.json` → `firebase deploy --only hosting`
- no host yet: recommend one under Your part (a static host such as Cloudflare Pages, Netlify, Vercel or GitHub Pages) with its one-time setup; do not create an account or a project.

**iOS and Android with Expo (EAS)**:
- `eas build -p ios --profile production --non-interactive --auto-submit` (to TestFlight), `eas build -p android --profile production --non-interactive --auto-submit` (to the internal track).
- Without `eas.json` or a production profile: a readiness task for the profile; `eas build:configure` needs a login, so it is the person's part.
- Known traps:
  - The **first** iOS build needs a real terminal: EAS asks for the Apple login and sets up the certificates only when stdin is a TTY. That build is the person's part before the release; later ones run non-interactive.
  - Submitting with an App Store Connect API key needs the key's role to be **App Manager**; the key is uploaded to EAS, and its `.p8` stays out of git.
  - Do not put an `ascAppId` placeholder into `eas.json`: leave it out until EAS created the app and printed the id.
  - Install `expo-updates` before the first `eas build` when the app uses updates, or the CLI stops on a question.
  - `npm install` conflicts with peer dependencies of config plugins: an `.npmrc` with `legacy-peer-deps=true` (a readiness task, not a change now).

**Other stacks**: what the project already set up (a fastlane lane, `fly deploy`, a container registry, a deploy script in `package.json`). Nothing set up: the person's part.

**Your part** is split. **Before the release**: accounts (Apple Developer, Google Play Console, the host), one-time logins (`eas login`, `wrangler login`), keys, the first interactive build, a store listing. **After the release**: the store review, testers, the privacy answers, announcing it. Each is a `- [ ]` item; the person ticks what they did, and the autopilot waits on the open ones before the release.

## 5. `.specify/memory/release.md`

```markdown
# Release: <app>

**Version**: 1.0.0 (iOS build 1, Android versionCode 1)
**Targets**: web (Cloudflare Pages), ios (EAS → TestFlight)
**Ready**: yes

## Checks

| Area | Check | Result | Evidence |
|---|---|---|---|
| Build | `npx expo export -p web` succeeds | pass | dist/ 1.9 MB |
| Store | ios.bundleIdentifier in app.json | fail → T071 | app.json has none |
| Permissions | location usage text (FR-023) | fail → T072 | expo-location without locationWhenInUsePermission |
| Secrets | no .env, *.p8, *.p12 or keystore tracked | pass | git ls-files |
| Privacy | App Store privacy labels | your part | drafted under Your part |

## Release commands

1. `npx wrangler pages deploy dist --project-name tagesinspiration`
2. `eas build -p ios --profile production --non-interactive --auto-submit`

## Your part

Before the release:
- [ ] `wrangler login` once (a Cloudflare account)
- [ ] The first iOS build in a terminal: `eas build -p ios --profile production`

After the release:
- [ ] App Store privacy labels: location (approximate, not linked to you), no tracking
- [ ] Add internal testers in TestFlight

## Releases

| Date | Version | Target | Result | Where |
|---|---|---|---|---|
```

`**Ready**` is your word on the app: `yes` when every check passes or is the person's, `no — <why>` otherwise. The person's part before the release does not make it `no`: the autopilot waits on its open boxes by itself. Result is `pass`, `fail → T###`, `your part` or `n/a`.

End the turn with one sentence: how many checks pass, how many became readiness tasks, and what is the person's part before the release.

## 6. After the person's yes

Run the release commands as written, in order, once each. A command that asks for a login, a password, a two-factor code or any interactive answer: stop there, do not work around it, and add it to Your part before the release. Stop at the first command that fails. Then append one row per target to `## Releases` (the date, the version, the target, `shipped` or `failed`, the URL, the build id or the error). Do not change the app, do not commit, do not push.
