import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState({}, "", path);
  emit();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onPop = () => emit();
      window.addEventListener("popstate", onPop);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("popstate", onPop);
      };
    },
    () => window.location.pathname,
  );
}
