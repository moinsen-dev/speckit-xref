# Feature Specification: Wrapped Lines

**Input**: User description: "Ideas for the day."

### User Story 1 - Ideas now (Priority: P1)

1. **Given** a free afternoon and
   a budget, **When** the person asks, **Then** three ideas appear
   with a reason each.
2. **Given** rain, **When** asked, **Then** indoor ideas come first.
   - a nested bullet is its own item

## Requirements *(mandatory)*

- **FR-001**: System MUST ask at most 3 questions: time available
  (e.g. up to 30 minutes, 1–2 hours, a weekend), budget and place.
- **FR-002**: System MUST work offline.
| a table row | is no continuation |

## Out of Scope

- Booking and payment; the app
  only inspires.

## Assumptions

- Platform: an Expo app instead of the Astro web app first named (per the
  person's own input).
