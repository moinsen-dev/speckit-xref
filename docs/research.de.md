# speckit-xref: Recherche (v2, Basis GitHub Spec Kit)

**Ziel:** Ziel, Vision, ToDos, aktuelle Tasks und Status sollen immer sichtbar sein. Spezifikation und Code werden in beide Richtungen verknüpft (X-Ref). Dazu kommt ein aktiver Schutz gegen Drift zwischen der Idee des Users und der Implementierung.

**Entscheidung (Uli, 2026-10-09):** Wir erfinden kein eigenes Spec-Format. Wir setzen auf das etablierte **GitHub Spec Kit** und erweitern es um das, was nur ein Claude-Code-Mod kann.

Stand: 2026-10-09
- Spec Kit **v1.1.2** (140k Sterne, MIT, Push 2026-10-08)
- Claude Code Build 2.1.293
- Beide APIs sind in Bewegung: Die Extension-API von Spec Kit gilt als experimentell, die Mod-API als Early Access.

---

## 1. Spec Kit in einer Minute

**Workflow:** `/speckit.constitution` → `specify` → `clarify` → `plan` → `tasks` → `analyze` → `implement` → `converge`. Dazu kommen `checklist` sowie Extensions und Presets.

**Dateien im Projekt:**
```
.specify/
  memory/constitution.md       Projekt-Prinzipien (MUST/SHOULD), am ehesten die „Vision“
  feature.json                 { feature_directory } = AKTIVES Feature (oder Env SPECIFY_FEATURE[_DIRECTORY])
  extensions.yml               installierte Extensions + Hook-Registrierungen
  templates/ scripts/ presets/ extensions/
specs/NNN-feature-name/
  spec.md                      Input: "<Originalwortlaut des Users>", User Stories (P1..), FR-001…, SC-001…, Edge Cases, Key Entities, Assumptions
  plan.md research.md data-model.md quickstart.md contracts/ checklists/
  tasks.md                     - [ ] T012 [P] [US1] Create User model in src/models/user.py
.claude/skills/speckit-*/SKILL.md   die Claude-Integration (Skills-Layout)
```

**IDs:**
- `FR-###` (Requirements) und `SC-###` (Success Criteria) gelten **pro Feature**.
- User Stories heißen `US1…` mit Priorität `P1…`.
- Tasks heißen `T###`, mit `[P]` für parallel ausführbar und `[USn]` für die zugehörige Story.
- **Die Task-Zeilen nennen schon die Dateipfade.** Damit gibt es ein Gerüst für die Verknüpfung Task → Datei, ohne dass Annotationen nötig sind.

**Was Spec Kit nicht persistiert:**
- Die Verknüpfung **FR → Task** gibt es nicht. `/speckit.analyze` leitet sie per LLM her (Tabelle „Requirement | Has Task? | Task IDs“), arbeitet streng read-only und verwirft das Ergebnis wieder.
- Die Verknüpfung **Code → FR** gibt es überhaupt nicht.

**Extension-Mechanik:** In `extension.yml` stehen Commands (`speckit.<ext>.<cmd>`), Templates, Scripts und Hooks auf Lifecycle-Events (`before_/after_specify|plan|tasks|implement|analyze`). Diese Hooks sind **Prompt-Ebene**: Die Command-Templates lesen `.specify/extensions.yml` und weisen den Agenten an, den Hook-Command auszuführen. Die Claude-Integration bildet außerdem kanonische Agent-Events (`session_start`, `pre_tool_use`, `post_tool_use`, `user_prompt_submit`, `stop`, `session_end`) auf **klassische Hooks in `.claude/settings.json`** ab. So arbeitet etwa spec-gates.

**Persistenz-Modelle** (Spec Kit lässt die Wahl offen):
- *Flow-back*: Alles darf alles beeinflussen. Hauptrisiko laut Doku ist „silent divergence“.
- *Flow-forward*: Feature-Ordner sind unveränderlich, Änderungen bekommen ein neues Feature.
- *Living spec*: `spec.md` ist der Vertrag, plan und tasks werden daraus abgeleitet.

Was „Drift“ bedeutet, hängt also vom Modell ab und muss konfigurierbar sein.

## 2. Was es im Spec-Kit-Ökosystem schon gibt

179 Community-Extensions. Die relevanten:

| Projekt | Art | Was es tut | Was fehlt |
|---|---|---|---|
| **SpecKit Companion** (alfredoperez, 97★, v0.36.0 vom 2026-10-06) | VS-Code-Extension, **Claude-Code-Mod** und Spec-Kit-Extension | Mod mit Band (Spec, Task-Balken, Phase) und Pane (Tabs Run, Overview, Specs), Tasks werden live abgehakt, `/speckit-tracker` | Laut eigener Aussage **„The mod only reads“**: Es liest die Konversation nicht und gibt jeden Call unverändert durch. Kein X-Ref, kein Drift-Schutz, keine System-Prompt-Injection, keine Model-Calls. |
| sync (bgervin) | Extension | `/speckit.sync.analyze`: Drift-Report Spec gegen Code, mit LLM-Auflösung | nur Batch, nachträglich |
| reconcile (stn1slv) | Extension | Spec, Plan und Tasks nach dem Merge chirurgisch an den Code angleichen, Remediation-Tasks | nur Batch, PR-Phase |
| intent (SuhaibAslam) | Extension | Entscheidungen aus der Implementierung gegen den genehmigten Intent abgleichen | nur Batch |
| trace (Quratulain-bilal) | Extension | Traceability-Matrix Requirement → Test (`.specify/trace.md`) | nur Tests, kein Code, nicht live |
| spec-gates (schwichtgit) | Extension + klassische CC-Hooks | PreToolUse, PostToolUse und Stop erzwingen Policy (geschützte Dateien, Bash) | Policy-Gates ohne Spec-Inhalt, keine UI |
| retrospective, ci-guard, status, companion | Extensions | Adherence-Score, CI-Gate, Status-Report | alle nachträglich oder auf Abruf |
| Core `/speckit.analyze` + `/speckit.converge` | Core | Konsistenz der Artefakte bzw. Lücken als neue Tasks | Batch, read-only bzw. Tasks |

**Die Lücke:** Visualisierung gibt es schon (Companion), Drift-Erkennung als Batch nach dem Bauen auch (sync, reconcile, intent, converge). **Niemand schützt live im Agent-Loop:** Keiner gibt dem Modell bei jedem Request den Spec-Kontext mit, keiner ordnet jede Datei-Änderung sofort FR, Story und Task zu, und keiner misst nach jedem Turn, ob der Wortlaut des Users, die Spec und der Diff noch zusammenpassen. Genau das kann nur ein Mod, und genau dort setzen wir an.

## 3. Positionierung: zwei Teile, ein Datenmodell

```
            specs/NNN-*/spec.md · tasks.md · .specify/memory/constitution.md   (Spec Kit, unverändert)
                                        │
                     specs/NNN-*/xref.json   ← unser einziges neues Artefakt (FR ↔ US ↔ T ↔ Datei)
                        ▲                                   ▲
      A) Claude-Code-Mod `speckit-xref`         B) Spec-Kit-Extension `xref`
         live, im Loop, nur Claude Code            Batch und CI, jeder Agent (Copilot, Codex, …)
         prompt.compose · tool.call ·              /speckit.xref.map · .check · .report
         turn.complete · Band/Pane                 Hooks: after_tasks → map, after_implement → check
```

- **A (Kern, zuerst):** Der Mod ist die Live-Schicht. Er liest Spec Kit, schreibt nur `xref.json` und optional den Intent-Log.
- **B (danach):** Die Extension macht dasselbe Datenmodell für alle anderen Agenten und für CI nutzbar. Installiert wird sie mit `specify extension add xref --from …` und bei Reife in den Community-Katalog eingetragen.
- **Companion bleibt Companion.** Wir bauen dessen Dashboard nicht nach (siehe Entscheidung 1).

### Die fünf Sichten des Users in Spec-Kit-Begriffen

| Sicht | Quelle in Spec Kit |
|---|---|
| **Vision** | `constitution.md` (Prinzipien, MUST-Regeln) |
| **Ziel** | `spec.md`: `Input`-Zeile (Originalwortlaut), User Stories nach Priorität, Success Criteria |
| **ToDos** | `tasks.md`: offene `- [ ]` |
| **aktuelle Tasks** | der Task, den der Agent gerade bearbeitet (erkannt über die Dateien seiner `tool.call`s gegen die Pfade der Tasks), sonst das erste offene T der aktuellen Phase |
| **Status** | Phase des Workflows, Anteil abgehakter Tasks, Coverage der FRs, **Drift-Ampel** |

## 4. X-Ref-Modell

Die Kette lautet **FR/SC ↔ US ↔ T ↔ Datei(:Symbol)**. IDs werden global qualifiziert als `001-auth/FR-003`, weil FR-Nummern nur pro Feature eindeutig sind.

| Kante | Woher | Wie verlässlich |
|---|---|---|
| T → US | `[USn]` in `tasks.md` | deterministisch |
| T → Datei (Soll) | Pfade in der Task-Beschreibung | Heuristik (Freitext), gut genug |
| T → Datei (Ist) | `tool.call` Edit/Write, während T aktiv ist | deterministisch, live |
| FR → T | **fehlt in Spec Kit.** Einmal per LLM erzeugen (bei `after_tasks` bzw. beim ersten Lauf), dann **persistieren** statt jedes Mal neu ableiten wie analyze | LLM, vom User bestätigbar |
| Code → FR (dauerhaft) | optionaler Anker `// @spec 001-auth/FR-003` auf Datei- oder Funktionsebene, mit grep auffindbar | deterministisch |

`xref.json` wird abgeleitet und ist regenerierbar. Wahrheit bleiben die Spec-Kit-Dateien und die Anker. Das Modell kann den Index über registrierte Tools abfragen und pflegen (`speckit_xref_where(file)`, `speckit_xref_link(id, file)`).

## 5. Drift-Schutz: verhindern, erkennen, korrigieren

**1. Verhindern (an der Quelle, der eigentliche Hebel):**
- `prompt.compose` legt eine eigene System-Prompt-Section bei **jedem** Request an:
  - MUST-Regeln der Constitution
  - Ziel des aktiven Features (Input und Stories)
  - aktiver Task mit seinen FRs und Soll-Dateien
  - Out of Scope und Assumptions
- Der feste Block bekommt `cache: true` und kostet dadurch kaum etwas.

**2. Erkennen:**
- **Deterministisch** in `tool.call` und `turn.complete`:
  - Edit außerhalb der Soll-Dateien des aktiven Tasks: **Scope Creep**
  - Task abgehakt ohne Datei-Änderung
  - FR ohne Task und ohne Anker
  - Anker auf eine unbekannte ID: **dangling**
  - Code nach dem letzten Spec-Update geändert: **stale**
- **Intent** über `prompt.submit`: Mitten in der Implementierung äußert der User neue Wünsche („mach das lieber so…“). Das ist **die häufigste Drift-Quelle**, denn diese Wünsche fließen nie zurück in `spec.md`. Der Mod protokolliert sie und markiert sie als „Intent-Änderung nicht in der Spec“.
- **Semantisch** in `turn.complete` über `$.model.fork`: eine tool-lose Frage über das gesamte Transcript (Originalwortlaut, Spec, Diff dieses Turns). Das Ergebnis ist ein Score von 0–100 mit Begründung. Es läuft nur, wenn sich Dateien geändert haben, über den Prompt-Cache.

**3. Korrigieren (Buttons im Pane, der Mod führt nichts ungefragt aus):**
- „In Spec übernehmen“ startet über `$.prompt.submit` die passende Spec-Kit-Route: `/speckit.clarify …` beim Modell *living*, eine neue Feature-Spec beim Modell *flow-forward*.
- „Als Task erfassen“ legt einen Remediation-Task an, im Stil von reconcile bzw. converge.
- „Anker setzen“ ruft `speckit_xref_link` auf.

**Modi** (`userConfig`): `advisory` als Default (Section, Ampel, Toast) und `strict`, das Edit/Write ohne Bezug zum aktiven Task mit `{deny}` blockiert. Dazu kommt `persistence: flow-back | flow-forward | living`, das festlegt, welche Abweichung als Drift gilt.

## 6. Mod-API: was wir davon brauchen

Ein Mod besteht aus `.claude-plugin/plugin.json`, `hooks/hooks.json` und `hooks/register.tsx`. Wer `$.state` nutzt, braucht zusätzlich `types/index.d.ts`. Das Modul läuft in einer Sandbox ohne Node; nach außen kommt es nur über `$`.
- Dev-Loop: `claude --plugin-dir`, `claude plugin validate --strict`, `tsc -p` und `claude plugin test`.
- **Plugin-Tests können keine Dateien lesen**, deshalb erzeugt man Fixtures aus `specs/`-Beispielen. Companion zeigt, wie das geht.

| Zweck | API |
|---|---|
| Spec-Kit-Dateien lesen | `$.fs.read/list/stat` (max. 4 MiB, **kein watch**, deshalb `$.clock.every` plus Re-Read nach `tool.call`, wie bei Companion) |
| aktives Feature | `.specify/feature.json` bzw. `$.env.get('SPECIFY_FEATURE_DIRECTORY')` |
| System-Prompt-Section | `on('prompt.compose')`: zu `next(e).sections` eine Section hinzufügen (`scope:'session'`) |
| Intent-Log | `on('prompt.submit')` |
| Live-X-Ref, Strict-Gate | `on('tool.call', {tool:'Edit'|'Write'|…})`, Guard mit `.catch` |
| Drift-Check | `on('turn.complete')` → `$.model.fork` bzw. `$.model.complete` (`claude-haiku-5-5`) |
| Tools für das Modell | `$.tool.register` (`isDeferred:false`) und `tool.call`-Matcher `mcp__speckit-xref__*` |
| Korrektur auslösen | `$.prompt.submit` (startet einen Turn, sobald die Session idle ist) |
| UI | `$.ui.status` (Ampel), eigener Pane `speckit-xref`, `$.ui.toast` |
| git | `$.process.run({argv:['git','diff',…]})` |
| Zustand | `$.state` für die Session, `$.store` über Sessions hinweg, `xref.json` im Repo |

## 7. Risiken

- **Zwei bewegliche APIs.** `requires.speckit_version: ">=1.1.0,<2.0.0"` pinnen, die Mod-Types bei jedem CC-Update neu erzeugen, `validate` und `test` in CI laufen lassen.
- ~~**Konflikt um das Band mit Companion.**~~ *Entschärft (Build, 2026-10-09):* Companion ruft in seinem `AbovePrompt`-Hook `next(e)` auf und stapelt sein Band über dem der anderen Plugins. speckit-xref macht es genauso. Beide Bänder erscheinen also untereinander, statt der Statuszeile nutzt der Mod deshalb ein eigenes Band. Ob zwei Panes verschiedener Plugins gleichzeitig andocken, ist mit installiertem Companion **noch ungeprüft**.
- **Prompt-Cache (beim Bauen entdeckt):** Ändert sich der System-Prompt, wird der Cache der ganzen Konversation ungültig. Deshalb trägt `prompt.compose` nur stabile Spec-Inhalte. Aktiver Task und Drift-Status reisen als `context` am User-Prompt bzw. am Tool-Ergebnis, also hinter dem Cache.
- **Pfade in tasks.md sind Freitext.** Die Heuristik muss tolerant sein, Fehltreffer zeigen wir als „unklar“, nicht als Drift.
- **Rauschen und Token-Kosten.** Der semantische Check läuft nur bei Datei-Änderungen und gecacht. Die deterministischen Checks sind kostenlos und kommen zuerst.
- **Strict-Modus kann nerven.** Deshalb ist er opt-in, und ein Deny nennt immer den Weg nach vorn („Task wechseln“ / „Anker setzen“ / „in Spec übernehmen“).
- `/plugin install` geht nur im Terminal. Im Desktop-Code-Tab wird mit `CLAUDE_CODE_PLUGIN_DIRS` entwickelt.

## 8. Offene Entscheidungen

1. **Visualisierung**
   - *Ergänzen*: Companion für Run, Tasks und Overview; wir zeichnen nur X-Ref und Drift (eigenes Band plus eigener Pane).
   - *Eigenes Dashboard*: Ziel, Vision, ToDo, Tasks und Status selbst, Companion überflüssig.

   **Empfehlung: ergänzen.** Companion ist gepflegt (Releases im Tages-Takt, MIT) und deckt die Ansichten schon gut ab. Unser Pane zeigt trotzdem einen kompakten Kopf (Ziel, aktiver Task, Status), damit der Mod auch allein brauchbar ist.
2. **Härte:** `advisory` als Default, `strict` opt-in. **Empfehlung: so.**
3. **Lieferform:** erst nur der Mod, oder Mod und Spec-Kit-Extension. **Empfehlung:** zuerst der Mod (Phase 1–4), die Extension in Phase 5. Beide teilen sich `xref.json`.

## 9. Bauplan

1. **Phase 1–4 erledigt 2026-10-09** (`mod/`). Spec-Kit-Reader: constitution, `feature.json`, spec (Input, US, FR, SC), tasks (T, US, Pfade, Häkchen).
   Prüfung: Fixture-Tests auf Spec-Kit-Beispielen.
2. `prompt.compose`-Section und Intent-Log über `prompt.submit`.
   Prüfung: Die Section steht im Request, der Log wächst.
3. `tool.call`-Tracking, `xref.json`, Tools `where/link`, Band-Ampel, Pane.
   Prüfung: Ein Edit außerhalb der Soll-Pfade wird gelb.
   Pane neben Companion testen.
4. `turn.complete`: deterministischer Check plus `model.fork`-Intent-Check, Korrektur-Buttons.
   Prüfung: Ein provozierter Intent-Bruch wird rot und hat einen Button für `/speckit.clarify`.
5. Spec-Kit-Extension `xref` (`map/check/report`, Hooks `after_tasks/after_implement`). **Erledigt 2026-10-09** (`extension/`).
6. Marketplace (`.claude-plugin/marketplace.json`), README, Eintrag in den Spec-Kit-Community-Katalog.
