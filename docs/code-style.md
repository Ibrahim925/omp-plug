# Code Style

> Read this before writing or reviewing code here. Match the surrounding file
> over any general preference.

The house style, shown by one real pair from `server/src/live.ts`:

```ts
// Clamp (rather than reject) oversized names/descriptions: omp skill commands
// routinely carry descriptions past any fixed cap, and a single long one must
// not invalidate the whole register frame (it silently killed controllability).
const commandInfoSchema = z.object({
  name: z.string().min(1).transform((s) => s.slice(0, 100)),
  description: z.string().transform((s) => s.slice(0, 400)).optional(),
});

function send(ws: Ws, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Socket closing mid-send — drop; close handler cleans up registry state.
  }
}
```

## Conventions (observed, enforced)

- **TypeScript, ES modules, Bun runtime.** 2-space indent, double quotes,
  semicolons. Explicit `.ts`/`.tsx` import extensions.
- **`import type` for type-only imports.** Import order: node builtins →
  external (`bun`, `zod`, `react`) → local (`./x.ts`).
- **Comments explain *why*, not *what*.** The load-bearing comment above a
  regex, a clamp, a race, or a workaround is expected — it records the constraint
  that would otherwise be re-broken. Keep them; extend them when you change the
  code they guard.
- **Validate all untrusted input with zod** at the boundary (see `live.ts`),
  clamping rather than rejecting where a partial frame is still useful.
- **Fail-soft in `extension/`.** Never throw out of a handler, never block the
  host omp session; swallow transient errors and let managed timers retry.
- **`Record<K,V>` for small static string-keyed tables; `Set`/`Map` only for
  runtime collections** (dynamic keys, insert/delete, `.size`, iteration).
- **Don't extract one-expression helpers** unless the name is a durable
  contract or there are 3+ lockstep call sites — inline instead.
- **Errors should be actionable:** say what was found, why it's wrong, and the
  fix — not just "failed".

## Verification

- Web is strict-typechecked: `cd web && bunx tsc --noEmit` (part of `make check`).
- Server/extension are Bun-runtime TypeScript with **no** standalone typecheck
  configured (the SDK is unresolvable at author-time; see `docs/architecture.md`).
  Bun strips/checks types at run. Keep them clean by construction and by reading
  the SDK source when extending the `types.ts` contracts.
