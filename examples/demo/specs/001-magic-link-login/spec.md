# Feature Specification: Magic Link Login

**Feature Branch**: `001-magic-link-login`
**Created**: 2026-10-09
**Status**: Draft
**Input**: User description: "Users sign in with a one-time link sent by email. No passwords."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request a login link (Priority: P1)

A user enters their email address and receives a login link.

**Acceptance Scenarios**:

1. **Given** a registered email, **When** the user requests a link, **Then** an email with a single-use link is sent.

### User Story 2 - Sign in from the link (Priority: P1)

A user opens the link and is signed in.

### User Story 3 - Expired links (Priority: P2)

A user who opens an old link is told to request a new one.

### Edge Cases

- The same link is opened twice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to request a login link by entering their email address.
- **FR-002**: System MUST send a single-use link that expires after 15 minutes.
- **FR-003**: System MUST sign the user in when a valid link is opened.
- **FR-004**: System MUST reject expired or reused links with a clear message.
- **FR-005**: System MUST rate-limit link requests to [NEEDS CLARIFICATION: how many per hour?]

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of users are signed in within 2 minutes of requesting a link.

## Out of Scope

- Password-based login
- Social login (Google, GitHub)

## Assumptions

- An SMTP provider is available.
