# Copilot Initialization

Use `CLAUDE.md` in the repository root as the canonical project instruction file.

## Required behavior

- Follow all rules in `CLAUDE.md` before making code changes.
- If this file conflicts with `CLAUDE.md`, `CLAUDE.md` wins.
- Preserve signed-off modules/tabs and avoid cross-module regressions.
- Respect Stellar API and asset-case rules documented in `CLAUDE.md`.
- Keep changes scoped to the requested feature/fix.

## Workflow

1. Read `CLAUDE.md` at task start.
2. Implement only the requested scope.
3. Validate changed files for errors.
4. Re-check touched files for regressions.
