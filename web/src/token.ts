// Shared secret, stored locally on the device. Attached to every API request
// and the live WS. Empty string means "no token" (open server).
const KEY = "omp_token";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // storage disabled — token just won't persist across reloads
  }
}

// Views listen for this to pop the token-entry gate when the server rejects us.
export function notifyAuthRequired(): void {
  window.dispatchEvent(new Event("omp-auth-required"));
}
