import { useEffect, useState } from "react";

import { usePath } from "./router.ts";
import { SessionList } from "./views/SessionList.tsx";
import { SessionView } from "./views/SessionView.tsx";
import { TokenGate } from "./views/TokenGate.tsx";

export function App() {
  const path = usePath();
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    const handler = () => setAuthRequired(true);
    window.addEventListener("omp-auth-required", handler);
    return () => window.removeEventListener("omp-auth-required", handler);
  }, []);

  if (authRequired) return <TokenGate />;

  const match = path.match(/^\/s\/(.+)$/);
  if (match) return <SessionView id={decodeURIComponent(match[1])} />;
  return <SessionList />;
}
