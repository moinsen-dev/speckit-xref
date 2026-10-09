# speckit-xref 0.4.0: Roadmap aus dem Expertenteam

Stand: 2026-10-09, nach v0.3.2. Sechs Perspektiven haben unabhängig und nur lesend gearbeitet. Kürzel in eckigen Klammern zeigen, wer einen Punkt vorgeschlagen hat:

| Kürzel | Perspektive |
|---|---|
| **SK** | Spec-Kit/SDD-Experte |
| **AU** | Autonomie-Architekt |
| **VE** | Verifikations-Ingenieur |
| **UX** | UX/DX-Designer |
| **API** | Mod-API-Scout |
| **ST** | Produktstratege/Skeptiker |

## Leitsatz für 0.4.0

**Rot muss etwas bedeuten, und „fertig“ muss bewiesen sein.**

Aus allen sechs Sichten kommt dasselbe Muster. Das Tool *behauptet* heute mehr, als es *belegen* kann:
- **Abdeckung:** Ein Requirement gilt als „covered“, sobald ein Task es nennt [VE, ST].
- **Fertig:** Ein Task gilt als „fertig“, sobald sein Kästchen abgehakt ist [AU, VE, SK].
- **CI-Ergebnis:** Die CI kann wegen einer veralteten LLM-Einschätzung rot werden [ST, VE, SK].
- **Fehlalarme:** Drei Konfigurationsdateien reichen für „rot“ [ST].

Bevor Autopilot und UI größer werden, muss dieses Fundament stimmen.

## Was das Team unabhängig voneinander gefunden hat (Bugs und API-Verstöße)

Diese Punkte sind Korrekturen, keine Features. Sie gehören an den Anfang.

| # | Befund | Quelle | Fix |
|---|---|---|---|
| B1 | Strict-Mode lässt Edits durch, wenn der Hook selbst fehlschlägt (`.catch(… next(e))`) | API | im Strict-Mode `next.called ? next(e) : { deny }` |
| B2 | Der Autopilot macht nach einem API-Fehler oder einer Verweigerung (`reason: error/refusal`) einfach weiter | API | pausieren, sobald `reason !== 'answer'` |
| B3 | Wettlauf: Drift-Check und nächster Autopilot-Schritt starten im selben Tick. Ein „contradicts“ kommt dann zu spät | ST, AU, API | `advance` wartet auf den Check; jedes Rot pausiert |
| B4 | `classify` in Python prüft Anker vor Plänen, TypeScript umgekehrt. Nachgewiesen: `token.ts` wird in Python als `linked`, in TS als `in-scope T004` eingestuft | VE | gemeinsame Verhaltensfälle (siehe A6) |
| B5 | `askedThisTurn` und `turnFiles` sind Modul-Variablen und gehen bei Reload oder `/config` verloren | API | in Atome verschieben |
| B6 | Fünf Tools mit `isDeferred: false` und ein Polling alle 4 s laufen auch in Repos ohne Spec Kit und kosten dort Kontext | API | `isDeferred: !initialized`, Polling nur mit `.specify/` |
| B7 | Die Pane öffnet sich unaufgefordert auch ohne Vollbild, entgegen der Doku | API | nur öffnen, wenn `viewport.isFullscreen` |
| B8 | `classify` (Fragen-Klassifikator) läuft blockierend in `turn.complete` | API | in `clock.after` verschieben |
| B9 | Schreibzugriffe über Bash (sed, Codegen, npm) bucht der Mod nie, die CI sieht sie aber. Live-Ansicht und CI widersprechen sich | ST, VE, API | am Turn-Ende `git status`-Diff, oder `classic.PostToolBatch` |
| B10 | Die CI prüft womöglich das falsche Feature: Spec Kit gitignored `feature.json`, der Fallback über mtime ist nach einem Checkout zufällig | ST, SK | Feature aus Branch (`NNN-*`) bzw. Diff ableiten, bei Mehrdeutigkeit laut abbrechen |
| B11 | `--fail-on` wertet den committeten LLM-Score mit aus | ST, VE, SK | LLM nie im Exit-Code |
| B12 | Die Spec-Kit-Einreichung nennt die falsche Version (STATE 0.1.1, extension.yml 0.1.3) | ST | angleichen |

## Themen und Priorität

### A. Vertrauen: das Fundament (Must)

- **A1 Rauschbudget** [ST]: Standard-Ausnahmen (Lockfiles, `*.config.*`, Manifeste, Migrationen) plus eine konfigurierbare Liste, dazu ein Eimer „unklar“ statt sofort „drift“. Zielwert: weniger als 20 % blinde „Accept“-Klicks.
- **A2 Bash-Writes buchen** (B9).
- **A3 Deterministische CI** (B10, B11): `--no-write` in der CI, damit sie `xref.json` nicht ständig umschreibt [VE].
- **A4 Ledger aufteilen** [ST]:
  - `xref.json` wird committet. Es enthält Zuordnung, Links und Acks, sortiert und ohne Zeitstempel. Das verhindert Merge-Konflikte.
  - `.xref.local.json` liegt in `.gitignore`. Es enthält Intents (also Prompt-Wortlaute, deshalb aus Datenschutzgründen lokal), LLM-Einschätzungen und Laufzustand.
  - Die Commit-Regel wird dokumentiert.
- **A5 Bugs B1–B8.**
- **A6 Verhaltens-Parität** [VE, ST]: `scripts/fixtures/cases.json` mit `{fn, input, expected}` für `classify`, `evaluate`, `link` und `parseSemantic`. Das läuft in `logic.test.ts` und als `xref.py selftest`.

### B. Beweis statt Behauptung (Must)

- **B1 Abdeckungsleiter** [VE]: spezifiziert → geplant → implementiert (Task fertig plus Anker im Quellcode) → getestet (Anker in einer Testdatei, `test.todo` zählt nicht) → bestanden (Testergebnis). Success Criteria bekommen eigene Stufen. Ledger `schema_version: 2`.
- **B2 Given/When/Then mit IDs** [VE, SK]: `US1-AS1` als Akzeptanzszenario. Anker dürfen darauf zeigen. Eine Story ohne Szenario wird zum Befund.
- **B3 Testergebnisse einlesen** [VE, AU]:
  - `xref.py verify --junit` liest JUnit-XML ein.
  - Der Mod führt einen `testCommand` aus. Er wird einmal erkannt und als Annahme festgehalten; die Quelle ist die `Testing:`-Zeile in `plan.md` [SK].
- **B4 Fingerabdrücke je Requirement** [VE, SK]: Ändert sich der Text eines FR, fällt er auf „geplant“ zurück und braucht neuen Beweis. Bei gleichem Hash unter neuer ID gibt es einen Umnummerierungs-Hinweis. Tests zu gelöschten FRs werden zu „verwaisten Tests“.
- **B5 Done-Gate** [VE, AU]: „Fertig“ verlangt bestandene Tests. Ausnahme ist ein reiner Test-schreiben-Task in TDD: Er ist fertig, wenn die Tests existieren und fehlschlagen.

### C. Spec Kit an der Quelle (Must, wenig Aufwand, große Hebelwirkung)

- **C1 xref-Preset/Bundle** [SK]:
  - `speckit.tasks` und `tasks-template` verlangen in jedem Task die Dateipfade in Backticks und `(FR-###)`. Damit entfallen beide Heuristiken: Pfaderkennung und Zuordnung.
  - `speckit.implement` bekommt die Regeln für Fokus, Anker und Haken.
  - Das Spec-Template bekommt IDs für Akzeptanzkriterien.
- **C2 Spec-Kontext in Spec Kits eigene Skills** [API]: Über `skill.prompt` (bei Skill-Layout) bzw. `classic.UserPromptExpansion` (bei Commands-Layout) bekommen `/speckit-implement`, `/speckit-clarify` und Co. den aktuellen Ledger-Zustand mit.
- **C3 `session.compact`-Anweisungen** [API]: Task, Intents und Entscheidungen überleben die Komprimierung.

### D. Autonomie mit Leitplanken (Must und Should)

Das Team ist hier uneins. ST rät, den Autopilot einzufrieren und nicht auszubauen. AU und SK wollen ihn grundlegend verbessern. **Synthese: vertrauenswürdig machen, nicht größer.** Keine neuen Phasen, kein Nachtbetrieb, kein Marketing, aber:
- **D1 Eine Story bzw. ein Task pro Schritt** [AU, SK]:
  - `/speckit-implement` läuft nur noch für „Phase 3 (US1)“. So beschreibt Spec Kit es selbst in `complex-features.md`.
  - Budget und Stall-Erkennung messen damit echte Arbeit, und nach P1 entsteht ein MVP-Stopp.
- **D2 Testbasierter Fortschritt und begrenzte Selbstreparatur** [AU]: höchstens drei Versuche, danach wird der Fall zur Entscheidung für dich.
- **D3 Spec-Gate mit Annahmen-Diff** [SK]: Genau eine Überprüfung dort, wo die Idee zum Vertrag wird, also nach `specify`. Die Pane zeigt die Input-Zeile neben den neuen FRs, die Out-of-Scope-Liste und die Annahmen, die der Agent hinzugefügt hat. Option `review: spec | spec+plan | none`.
- **D4 Der volle offizielle Ablauf** [SK]: `analyze` vor dem ersten Implement und nach jeder Spec-Änderung, Checklisten, und die Schleife `converge` → `implement`, bis `tasks.md` stabil ist. Der „proceed anyway?“-Riegel von `speckit-implement` bleibt beim Menschen.
- **D5 Antworten im selben Turn** [API]: `$.ui.ask(frage, optionen)` innerhalb des `ask`-Tools. Du beantwortest die Frage im nativen Dialog, und der Autopilot läuft im gleichen Turn weiter. Unter `-p` bleibt die bisherige Pause der Fallback.
- **D6 Leitplanken über `tool.check`, nur verschärfend** [AU, API]:
  - Abgelehnt werden: destruktive Befehle, `git push`, `reset --hard` außerhalb des Lauf-Branches, Writes in `.env*`.
  - Ein Permission-Dialog im unbeaufsichtigten Lauf wird zur Entscheidung. Er lässt den Lauf nicht hängen.
- **D7 Sofort-Stopp** [API]: `immediate: true` für `/xref auto off`, und **Stop** bricht den laufenden Turn mit `$.turn.abort` ab.
- **D8 Laufprotokoll, Kosten und Rückkehr-Briefing** [UX, AU]:
  - `xref-run.jsonl` zeichnet pro Schritt auf: Task, Dateien, Dauer, Tokens und Ergebnis.
  - Das Band zeigt `$1.80 · 23m`, gespeist aus `usage` und `$.session.usage()`.
  - In der Pane gibt es eine Karte „Seit du weg warst“.
- **D9 Commit pro bestandenem Task** [AU] (Should): auf einem Lauf-Branch. Weil `$.process.run` die Git-Hooks abschaltet, prüft der Mod den gestagten Diff selbst.
- **D10 Entscheidungs-Warteschlange** [AU] (Should): Eine Frage blockiert nur die Tasks, die von ihr abhängen.

### E. Flow-back: Wünsche erreichen die Spec sauber (Should)

- **E1 `speckit.xref.revise`** [SK]:
  - Ein neues FR bekommt eine neue ID. Ein ersetztes wird `SUPERSEDED by FR-00x`, ein gestrichenes `RETIRED`.
  - Tasks werden nur angehängt. Jede Änderung landet datiert in `revisions.md`.
  - „To spec“ ruft künftig diesen Befehl.
  - Ein offenes `extends` wird zur Phase `revise`. Ein `contradicts` pausiert immer.
  - Das passt zur offenen Spec-Kit-Issue #4156 und lässt sich später auf ein natives `/speckit.revise` umbiegen.
- **E2 Persistenzmodell** [SK, research.de.md §5]: Das Modell (Flow-back, Flow-forward oder Living Spec) wird aus der Constitution gelesen. Es bestimmt, was eine Spec-Änderung auslöst.

### F. Sichtbarkeit (Should)

Der Wunsch, dass Ziel, Vision, ToDos, Tasks und Status immer sichtbar sind, bleibt bestehen. ST rät zum Ausdünnen, UX schlägt einen kompakten und einen Detailmodus vor. **Synthese: kompakt standardmäßig, Details auf Tastendruck.**
- **F1 Aufmerksamkeits-Band** [UX] (Must):
  - Im Pausenzustand zeigt das Band zwei Zeilen: die volle Frage, dazu Resume, Stop und Pane.
  - Der Tab heißt dann „Spec X-Ref ⏸“, damit es auch hinter der Changes-Pane auffällt.
  - `$.ui.notify` meldet sich nach fünf Minuten Pause [UX, API, AU].
- **F2 Drift-Karten mit eigener Aktion** [UX] (Must):
  - Jeder Befund bekommt eine eigene Lösung: ein `Select` mit Tasks zum Verknüpfen (vorbelegt mit dem damals aktiven Task) und „Accept this“.
  - „Accept all“ verliert seinen Hotkey und fragt per `$.ui.ask` nach.
  - Zustände heißen ok / watch / off-spec mit den Glyphen ● ▲ ✖, Farbe ist nur ein Zusatz.
- **F3 Phasenleiste** [UX]: `✓setup ✓const ✓spec ✓plan ✓tasks ▶impl 7/8 ·verify`.
- **F4 Schmale Breiten zuerst** [UX]: unter 70 Spalten die kompakte Pane, Details mit `d`, sonst die volle Pane.
- **F5 Transcript-Chips** [UX, API] (Could):
  - Ein `ToolUse`-Badge `T006 · FR-004` bzw. `▲ unplanned` an jedem Edit.
  - Autopilot-Prompts werden zu `▶ auto 3/25 · implement · T005` zusammengeklappt.
- **F6 Deutsche Oberfläche** [UX] (Should): Option `language`. Vorher muss `nextStep` IDs liefern statt fertiger englischer Sätze, weil `why` und `needsUser` auch beim Modell landen.

### G. Verbreitung und Belege (Should)

- **G1 GitHub Action mit PR-Zusammenfassung** [ST, VE]: Anforderung → Task → Dateien, ungeplante Dateien und Wünsche, die nie in der Spec gelandet sind. SARIF später.
- **G2 Kennzahlen im Report** [ST]: gefangene ungeplante Edits und ihr Ausgang, Quote der blinden Accepts, Wünsche jenseits der Spec samt Anteil, der in der Spec gelandet ist, Tokens für Checks, Zeit bis zum ersten verifizierten Feature. Ohne Telemetrie: Das Telemetry-API ist für Mods von Drittanbietern ohnehin nicht nutzbar [API].
- **G3 Ein Moment, ein GIF** [ST]: „Also allow passwords“ → Band wird rot → eine Taste → `/speckit-clarify`. Das kommt ganz oben ins README.
- **G4 Reihenfolge** [ST]: erst Themenblock A fertig, dann die Katalog-Einreichung (sonst sind die ersten Eindrücke falsch-rote Builds), dann der Community-Marketplace. Der Blogpost erst mit Dogfood-Zahlen aus drei echten Features.

## Bewusst NICHT in 0.4.0

| Nicht bauen | Warum | Quelle |
|---|---|---|
| Ein Gate auf Basis der LLM-Einschätzung (CI-Fehler, Edit-Deny, Health-Score) | Ein LLM-Urteil ist eine Behauptung, kein Beweis. Der Hinweis an dich bleibt. | SK, VE, ST |
| Ein Worktree pro Task mit Auto-Merge | Bucht Edits als `.claude/worktrees/…`, hakt nur Kopien von `tasks.md` ab, und jeder Konflikt wird zur Entscheidung | AU, API |
| Raster- und Image-Grafiken im Terminal | Nicht auf Desktop verfügbar, nicht klickbar, umgeht das Theme | UX |
| Telemetry-API, `engine.create` mit eigenem `$.speckit`-Noun, `turn.step`-Hooks | Für Mods von Drittanbietern nicht nutzbar, verursacht Reload-Kosten oder greift in jeden Request ein | API |
| Autopilot ausbauen (neue Phasen, Nachtbetrieb, Headless-Treiber, parallele Subagents, standardmäßig an) | Erst Vertrauen schaffen. Das ist Material für 0.5. | ST, AU (teilweise) |
| Adapter für andere Spec-Tools | Fokus auf Spec Kit | ST |

## Vorschlag zur Reihenfolge

1. **A (Fundament plus Bugs) und C1–C3**. Das ist die Voraussetzung für alles Weitere.
2. **B (Beweis)**: Abdeckungsleiter, G/W/T, JUnit, Fingerabdrücke, Done-Gate.
3. **D1–D8** (Autonomie mit Leitplanken) und **F1–F4** (Sichtbarkeit).
4. **E1** (Revise) und **G1–G2** (Action, Kennzahlen).
5. Release 0.4.0, danach Dogfood auf drei echten Features und Katalog-Einreichung.

D9/D10, E2, F5/F6 und G3 sind Kandidaten für 0.4.x.

## Offene Entscheidungen (beim Owner)

1. **Autopilot:** nur vertrauenswürdig machen (Empfehlung) oder auch ausbauen?
2. **Spec-Gate:** eine Überprüfung nach `specify` standardmäßig an (Empfehlung) oder aus, für maximale Autonomie?
3. **Umfang:** alles in 0.4.0 oder aufteilen in 0.4.0 (A, B, C) und 0.4.1 (D, E, F, G)?
4. **Deutsche Oberfläche:** in 0.4.0 oder später?
