---
name: validate
description: Research and validate a product idea before it becomes a Spec Kit spec - who has the problem, what already exists, what would make it different, the riskiest assumption, when to stop - and write .specify/memory/idea-brief.md for the person to decide Build, Sharpen or Drop. Use when the speckit-xref autopilot hands over a validate step, when a person brings a new idea for a project, or asks whether an idea is worth building.
---

# Validate an idea

The person has an idea. Before it becomes a spec, find out whether it is worth building and what it must do better than what exists. You write the evidence; **the person decides** (Build, Sharpen or Drop in the speckit-xref pane). Never write that decision yourself.

## 1. Research

If the agent type `speckit-xref:idea-researcher` is offered, hand the research to it (the Agent tool, one call, the idea in the person's words as the prompt) and work from its report. Otherwise research yourself with WebSearch and WebFetch.

Answer five questions:

1. **Who has the problem**, how often, and what it costs them. Evidence beats opinion: forums, reviews, articles.
2. **What already exists**: apps, services, workarounds (a spreadsheet, a group chat). For each, what it does well and where it falls short.
3. **What makes this idea different** from those, in one sentence a stranger understands.
4. **The riskiest assumption**: the belief that, if wrong, makes the idea pointless. How to test it cheaply and early.
5. **When to stop**: concrete signals that would end the project (kill criteria).

**Never invent a source.** An alternative counts as verified only with a URL you fetched in this session. Anything you know without fetching it gets `(unverified)`. Without web tools, write `**Research**: none (no web tools in this session)` and keep the brief honest about it. A made-up competitor list is worse than none.

## 2. Score

Score each criterion from 1 to 5 and say why in one line:

| Criterion | Weight | 5 means |
| --- | --- | --- |
| Problem severity | 25 % | the people who have it feel it often and would pay or change habits to fix it |
| Clear audience | 15 % | you can name who uses it and where to find them |
| Differentiation | 25 % | existing alternatives leave a clear gap this idea fills |
| Feasibility | 15 % | the first version is buildable with the planned stack in weeks, not months |
| Testable risk | 20 % | the riskiest assumption can be checked cheaply before most of the work |

The score is the weighted sum, one decimal. Recommend **build** from 3.5, **sharpen** from 2.5, **drop** below; say in one sentence what would raise the score.

## 3. Write `.specify/memory/idea-brief.md`

Exactly this shape (the pane and the spec read it):

```markdown
# Idea Brief: <short name>

**Idea**: "<the person's words, verbatim>"
**One-liner**: <what it is, for whom, why it is better, in one sentence>
**Recommendation**: build | sharpen | drop
**Score**: <x.y> / 5
**Research**: web (<n> sources) | none (no web tools in this session)

## Who has the problem
<2-4 sentences with evidence>

## Alternatives
- [<Name>](<url you fetched>): <what it does>; <where it falls short>
- <Name> (unverified): <what it does>; <where it falls short>

## What makes it different
<one paragraph>

## Riskiest assumptions
1. <assumption> (test: <cheapest way to check it>)

## Kill criteria
- <signal that ends the project>

## Success measures
- <measurable outcome, e.g. "70 % of first-time users get a suggestion within 3 taps">

## Score
| Criterion | Weight | Score | Why |
| --- | --- | --- | --- |
| Problem severity | 25 % | <1-5> | <why> |
| Clear audience | 15 % | <1-5> | <why> |
| Differentiation | 25 % | <1-5> | <why> |
| Feasibility | 15 % | <1-5> | <why> |
| Testable risk | 20 % | <1-5> | <why> |

## Sources
- <url>
```

Then end your turn with the one-liner, the score and the recommendation in two or three sentences. Do not ask whether to go on: the pane asks the person.

## Afterwards

The success measures become the spec's success criteria (SC-###), the riskiest assumption is what the first user story tests, and the differentiation belongs in the constitution. **Sharpen** brings you back here with what the person wants changed: research again and rewrite the brief.
