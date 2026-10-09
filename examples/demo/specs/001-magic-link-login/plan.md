# Implementation Plan: Magic Link Login

**Branch**: `001-magic-link-login` | **Spec**: [spec.md](./spec.md)

## Summary

Tokens are random 32-byte values stored hashed with an expiry; the link handler swaps a valid token for a session.

## Technical Context

**Language/Version**: TypeScript 5
**Storage**: in-memory store behind an interface
**Testing**: vitest
