// Resolves the installed omp coding-agent SDK without vendoring its (large) dep
// tree. Prefers normal module resolution (works if someone `bun add`s it into
// this workspace), then falls back to the global bun install where `omp` itself
// lives. The SDK ships as runnable TypeScript source, so Bun imports it directly.
import { homedir } from "node:os";
import { join } from "node:path";

import type { Sdk } from "./types.ts";

let cached: Promise<Sdk> | null = null;

async function resolve(): Promise<Sdk> {
  const attempts: string[] = [];
  const bunInstall = process.env.BUN_INSTALL || join(homedir(), ".bun");
  // Specifiers are runtime-selected: the fallback is an absolute path into the
  // global bun install that is not resolvable at author time, so `await import`
  // is required here (static import cannot express the fallback).
  const candidates = [
    "@oh-my-pi/pi-coding-agent",
    join(bunInstall, "install/global/node_modules/@oh-my-pi/pi-coding-agent/src/index.ts"),
  ];

  for (const spec of candidates) {
    try {
      const mod: unknown = await import(spec);
      if (
        mod &&
        typeof mod === "object" &&
        "SessionManager" in mod &&
        "FileSessionStorage" in mod &&
        "buildSessionContext" in mod
      ) {
        // Library boundary: the SDK's own types are not build-time visible from
        // this workspace, so assert against our locally-defined contract.
        return mod as unknown as Sdk;
      }
      attempts.push(`${spec}: loaded but missing expected exports`);
    } catch (err) {
      attempts.push(`${spec}: ${(err as Error).message}`);
    }
  }
  throw new Error(
    "Could not resolve the @oh-my-pi/pi-coding-agent SDK.\n" +
      "Install omp globally (bun add -g @oh-my-pi/pi-coding-agent) or add it to this workspace.\n" +
      "Tried:\n  " + attempts.join("\n  "),
  );
}

export function getSdk(): Promise<Sdk> {
  return (cached ??= resolve());
}
