---
name: prd
description: Review a product requirements document (PRD) the person wrote before building, and cut it into Spec Kit features - .specify/memory/prd-review.md (contradictions, untestable criteria, gaps, the open decisions that block the first feature) and .specify/memory/roadmap.md (features in build order with phase, scope as the PRD's own ids, PRD sections, the gate before each, the spec text). Use when the speckit-xref autopilot hands over a prd step, or when someone starts a project from a long PRD.
---

# Review a PRD and cut it into features

The person wrote the PRD first: its decisions are theirs, its research is done. Your job is not to rewrite it or research it again. It is to read it as the one who has to build it: where does it contradict itself, what can nobody test, what is missing for the first feature, and in which order does it get built.

Read `.specify/memory/prd.md` whole. Note its id families as it writes them (stories `US01`, features `F01`, requirements `N01`, acceptance criteria `AC01`, decisions `D01`, gates `G1`, phases `P0` …): the specs carry these ids later, so the trace runs from the PRD to the code.

## 1. `.specify/memory/prd-review.md`

```markdown
# PRD Review: <product>

**Recommendation**: build | sharpen
**Source**: .specify/memory/prd.md

## Blocking decisions (before the first feature)
- D03 AI provider and model: <what blocks, and your recommendation>
- <only what the first feature cannot be specified or built without; later phases' decisions are not blocking now>

## Contradictions
- <§x says … while §y says …>

## Untestable criteria
- <AC07: "feels natural" – suggestion for a check that can pass or fail>

## Gaps for the first feature
- <what the first feature needs and the PRD does not say>
```

**Recommendation** is `build` when the first feature can be specified now (blocking decisions can be asked in one round), `sharpen` when contradictions or gaps in it need the person first. Never decide a blocking decision yourself and never write it as decided.

## 2. `.specify/memory/roadmap.md`

One `##` section per Spec Kit feature, in the order they get built. The first one is the smallest the PRD itself says to build first (its MVP, P0, core). A phase that the PRD gates on real-world evidence (a test with users, a review, a store approval) gets that gate in **Gate before**: the autopilot stops there, it is the person's part.

```markdown
# Roadmap: <product>

**Source**: .specify/memory/prd.md

## 1. Solo core: one short show with 6–8 AI characters
**Phase**: P0
**Scope**: US01–US06, US12, US13, F01–F07, AC01–AC11
**Sections**: §5, §6, §7.1, §8
**Gate before**: none
**Spec**: <what /speckit-specify gets: the feature in the PRD's own words, one paragraph, with the platforms and constraints it names>

## 2. Solo beta with ~30 characters
**Phase**: P1
**Scope**: US07, US08, F08, AC12–AC14
**Sections**: §9, §22.3
**Gate before**: G1 – Fun & Replay (40 new adult testers, ≥ 35 % replay)
**Spec**: <…>
```

- **Scope** lists the PRD's ids this feature implements; ranges as `F01–F07`.
- **Sections** lists the PRD's sections as `§5`, `§6.1`, numbered as the PRD numbers them; they reach the intent check, so keep them to what the feature implements.
- **Gate before** is `none`, or the gate and what it takes.
- Nothing the PRD says to defer goes into an earlier feature.

## 3. End

End the turn with one sentence: how many features, what the first one is, and how many decisions block it. The person approves the roadmap next (Approve roadmap in the pane); then Shape asks only the blocking decisions, and the first feature is specified from its **Spec** text.
