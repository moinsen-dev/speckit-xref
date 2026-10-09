# Tasks: Magic Link Login

**Input**: Design documents from `/specs/001-magic-link-login/`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Create project structure in src/auth/ and tests/auth/
- [x] T002 [P] Configure mailer settings in src/config/mailer.ts

## Phase 3: User Story 1 - Request a login link (Priority: P1) 🎯 MVP

- [x] T003 [P] [US1] Contract test for POST /auth/link in tests/auth/request-link.test.ts
- [ ] T004 [US1] Implement token service in src/auth/token.ts (FR-002)
- [ ] T005 [US1] Implement POST /auth/link handler in src/auth/request-link.ts (FR-001)

## Phase 4: User Story 2 - Sign in from the link (Priority: P1)

- [ ] T006 [US2] Implement GET /auth/callback in src/auth/callback.ts (FR-003)
- [ ] T007 [US2] Reject expired or reused tokens in `src/auth/token.ts`

## Phase 5: User Story 3 - Expired links (Priority: P2)

- [ ] T008 [US3] Show an expiry message in src/ui/expired-page.tsx (FR-004)
