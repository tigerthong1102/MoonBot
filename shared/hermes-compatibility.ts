/** Features advertised by the installed Hermes executable in an ACP handshake. */
export interface HermesCompatibility {
  protocol: number | null;
  version: string | null;
  loadSession: boolean;
  resumeSession: boolean;
  images: boolean;
  sessionOpened: boolean;
  stage: "start" | "initialize" | "session/new" | "ready";
}
