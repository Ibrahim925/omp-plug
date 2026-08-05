<!-- Keep it short. Link the issue if there is one. -->

## What & why

<!-- What does this change, and what problem does it solve? -->

## How I verified

<!-- `make check` output, and — if this crosses the extension ↔ server ↔ browser
     boundary — the real path you exercised (a curl, a browser click-through). -->

## Checklist

- [ ] `make check` passes.
- [ ] If a wire shape changed, I updated all three sides (`extension/index.ts`,
      `server/src/types.ts`, `web/src/types.ts`) + zod in `server/src/live.ts`.
- [ ] No secrets committed.
- [ ] For a dependency, protocol, `scripts/`, or stack change: I opened an issue
      to discuss it first.
