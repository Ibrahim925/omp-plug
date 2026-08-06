// Directory browsing for the new-session cwd picker. Lists *directories only*
// (never file contents) so the operator can fuzzy-find a project root from the
// browser. Token-gated like the rest of /api. The client sends whatever is in
// the path field; we split it into an existing base dir + a filter fragment so
// typing "/Users/me/pr" lists "projects/" etc. under "/Users/me".
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  base: string;
  parent: string | null;
  entries: DirEntry[];
}

const MAX_ENTRIES = 300;

function isDir(path: string): boolean {
  try {
    // statSync (not lstat) so a symlink pointing at a directory still counts.
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a (possibly partial) path into a base directory to list plus the
 * directories inside it matching the trailing fragment. Empty input starts at
 * $HOME. Throws an actionable error when the base directory can't be read.
 */
export function listDirectories(input: string | null): DirListing {
  const home = homedir();
  let raw = (input ?? "").trim();
  if (raw.startsWith("~")) raw = home + raw.slice(1);
  if (!raw) raw = home;
  // Relative input is anchored at $HOME so the field never resolves against the
  // server's own cwd (which is meaningless to the operator).
  const abs = resolve(raw.startsWith("/") ? raw : join(home, raw));

  // A trailing slash, or an input that already names a real directory, means
  // "list inside here"; otherwise the last segment is a filter fragment.
  const wantsChildren = raw.endsWith("/") || isDir(abs);
  const base = wantsChildren ? abs : dirname(abs);
  const filter = wantsChildren ? "" : (abs.split("/").pop() ?? "");
  const needle = filter.toLowerCase();

  let names: string[];
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() || (d.isSymbolicLink() && isDir(join(base, d.name))))
      .map((d) => d.name);
  } catch (err) {
    throw new Error(`cannot read directory ${base}: ${(err as Error).message}`);
  }

  const entries = names
    .filter((name) => !needle || name.toLowerCase().includes(needle))
    .sort((a, b) => {
      // Prefix matches first, then visible-before-hidden, then alphabetical —
      // so the likely target surfaces at the top on a phone.
      if (needle) {
        const ap = a.toLowerCase().startsWith(needle);
        const bp = b.toLowerCase().startsWith(needle);
        if (ap !== bp) return ap ? -1 : 1;
      }
      const ah = a.startsWith(".");
      const bh = b.startsWith(".");
      if (ah !== bh) return ah ? 1 : -1;
      return a.localeCompare(b);
    })
    .slice(0, MAX_ENTRIES)
    .map((name) => ({ name, path: join(base, name) }));

  const parent = base === "/" ? null : dirname(base);
  return { base, parent, entries };
}
