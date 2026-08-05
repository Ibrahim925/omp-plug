# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a developer who self-hosts omp-plug to run `omp` coding-agent sessions
on their own machine and needs to watch and drive those sessions while away from
that keyboard — most often from a phone over Tailscale, but a desktop browser is
an equal, first-class way to use it. One operator per deployment.

Because omp-plug is meant to be shared with the wider omp community to
self-host, the interface must be legible to a stranger who did not write it, not
only to its author.

## Product Purpose

A self-hosted, browser-based dashboard to watch, control, create, and manage
live `omp` coding-agent sessions. Success is the full loop without returning to
the terminal: from a phone you can see every session, drive a live one
(prompt / steer / answer / abort), and create / rename / delete / resume
sessions and projects.

## Positioning

The differentiating mechanism is the `omp-report` extension that runs *inside
every omp session* — it is the only thing that can observe or drive a session,
and the server bridges those sessions to the browser over WebSocket. This makes
remote control genuine rather than simulated: answering a native `ask` from the
phone resolves as a real tool result, and sessions can be spawned or resumed
headless so any session is queryable from the browser rather than stuck
read-only. A neighboring "terminal-in-a-web-page" could not truthfully claim the
same native, session-owned control.

## Operating Context

Runs as a single Bun process (HTTP + WebSocket, port 7317) on the developer's
own machine, reached over loopback or Tailscale — never a hosted multi-tenant
cloud service. Installed via launchd on macOS. Typically added to the iOS home
screen as a PWA (required for Web Push). The agent side is the `omp-report`
extension loaded into each omp session; the browser client is a thin React SPA.

## Capabilities and Constraints

Capabilities:
- List every session (persisted history merged with the live registry), grouped
  by project (working directory), newest first.
- Create a session in a directory; rename it (live or persisted); delete it
  safely (a session the server did not spawn is never killed); resume an
  inactive session headless so it becomes controllable again.
- Live-stream turn events (text/thinking deltas, tool start/end) into a rendered
  transcript (markdown, syntax-highlighted code, images).
- Drive a running session: prompt / steer / abort / answer / dismiss, and answer
  a native `ask` tool from the browser.
- Web Push notifications to the phone when a session goes idle or raises an
  `ask`, deep-linking to the session.

Binding constraints (confirmed):
- **Mobile-first touch ergonomics:** thumb-reachable controls, large tap
  targets, and safe-area insets are required, not optional.
- **Token-only auth, no cloud:** a single shared secret gates the whole app; it
  runs on loopback/Tailscale only and must never assume a hosted, multi-tenant,
  or account-based deployment.
- **Fast and low-bandwidth:** it must feel instant on a phone on cellular —
  small payloads, no bloat.
- **Desktop and phone are co-equal, first-class targets:** wide viewports
  deserve a real layout, not a stretched phone view.

Technical context (current implementation, not a binding directive):
- Bun runtime; strict-TypeScript React 18 + Vite 6 client; `react-markdown`.
- The `@oh-my-pi/pi-coding-agent` SDK is resolved at runtime, not a build
  dependency.
- One WebSocket wire contract spans extension ↔ server ↔ browser and must change
  in lockstep across all three sides.

Terminology:
- **Session** — one omp run, persisted and optionally live.
- **Project** — sessions grouped by their working directory.
- **Live / controllable** — the extension is connected, so the session is
  driveable from the dashboard.
- **Inactive** — persisted and not currently connected; resumable.
- **Ask** — a native omp tool whose question the dashboard can answer.
- **Steer** — mid-turn input to a running session.

## Brand Commitments

- Wordmark: **"omp"** (PWA title and home-screen name). No separate logo asset
  beyond the app icons.
- Voice: plain, technical, developer-facing, honest — no marketing gloss.
- PWA identity: `theme-color` `#0b0d10`; installable icons at 180 / 192 / 512.

## Evidence on Hand

- A real, working application; core capabilities above were exercised end to end
  against a live server this session.
- Assets: `web/public/manifest.webmanifest`, `web/public/sw.js`, and app icons
  `web/public/icon-{180,192,512}.png`.
- No testimonials, customers, benchmarks, pricing, licensing, or press exist —
  future work must not fabricate any of these.

## Product Principles

1. **The phone is the primary console; the desktop is an equal peer.** Every
   capability must be fully operable by thumb and equally at home on a wide
   screen.
2. **Control is genuine, never simulated.** Actions map to real native session
   operations, and the UI must never imply control it does not have — the line
   between read-only and controllable is always honest and visible.
3. **Self-hosted and private by construction.** One operator, one shared secret,
   loopback/Tailscale only; never assume a cloud, accounts, or a network you do
   not control.
4. **Legible to a stranger.** Because others self-host it, session state
   (live / inactive / error), the consequence of a destructive action, and the
   next step must be self-explanatory without reading the source.
5. **Stay light and immediate.** Small payloads and instant feedback over
   cellular outrank feature richness; never make the phone wait.

## Accessibility & Inclusion

No formal standard is mandated. Product-specific requirements: one-handed
phone use with adequate touch-target sizing and iOS safe-area handling, and
respecting the operating system's light/dark preference (already honored).
