export interface EndedGateChecks {
  sessions(): Iterable<string>;
  env(session: string): NodeJS.ProcessEnv | null;
  running(session: string, env: NodeJS.ProcessEnv): boolean;
  inUse(session: string): boolean;
  release(session: string): Promise<void>;
}

export async function releaseEndedGates(checks: EndedGateChecks): Promise<string[]> {
  const released: string[] = [];
  for (const session of checks.sessions()) {
    const env = checks.env(session);
    if (!env || checks.inUse(session) || checks.running(session, env)) continue;
    await checks.release(session).catch(() => undefined);
    released.push(session);
  }
  return released;
}
