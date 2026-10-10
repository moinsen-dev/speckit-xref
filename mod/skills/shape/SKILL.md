---
name: shape
description: Settle with the person what the first version of a new product is - the MVP cut, platforms, language and internationalisation, design direction, data and accounts - before the Spec Kit spec is written, and record it in .specify/memory/product-brief.md. Use when the speckit-xref autopilot hands over a shape step, or before specifying the first feature of a new project.
---

# Shape the first version

Spec Kit's specify step decides on its own whatever the idea leaves open and calls it an assumption. For the first version of a product that is too much: scope, platforms, language and design are the person's decisions. Ask them first, briefly, and record the answers so the spec writes them as decided.

## Ask

Read the idea (and `.specify/memory/idea-brief.md` if it exists). Ask **only what they leave open**, in the AskUserQuestion dialog: at most 4 questions per round, each with 2-4 options, your recommended option first and marked "(Recommended)". Usually one round, two at most.

The topics, in this order:

1. **First version (MVP cut)**: which capabilities make the first release, and what waits. Offer a lean cut, a fuller one, and your recommendation based on the riskiest assumption.
2. **Platforms**: web, iOS, Android, desktop; one codebase or not.
3. **Language and internationalisation**: one language only, several, or i18n-ready from the start (all UI text through a translation layer).
4. **Design direction**: mood (calm, playful, professional …), a reference app or two, dark mode, accessibility level.
5. **Data and accounts**: local only, an account, sync, what leaves the device.

Skip a topic the idea already answers ("an Expo app" settles platforms). If nobody can answer (no dialog, a non-interactive run), do not wait: record each open point as your assumption.

## Write `.specify/memory/product-brief.md`

```markdown
# Product Brief: <short name>

## Decisions (the person's)
- First version: <…>
- Platforms: <…>
- Language: <…>
- Design: <…>
- Data: <…>

## Assumptions (Claude's)
- <what you decided because nobody could, and why>

## Later
- <what was explicitly left out of the first version>
```

Then end your turn with one sentence on the first version. The constitution and the spec come next and must treat the decisions as the person's, not as assumptions.
