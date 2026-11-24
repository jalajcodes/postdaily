// Configuration access that works on Node (process.env) and Cloudflare (Worker bindings).
type Vars = Record<string, unknown>;
let current: Vars = {};

export function setEnv(vars: Vars) {
  current = vars;
}

export function env(key: string): string | undefined {
  const v = current[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** "node" (local Mac server) or "worker" (Cloudflare). */
export const runtime = () => (env("RUNTIME") === "worker" ? "worker" : "node");
