import { sqlGeneration } from "./discovery.ts";

type ProbeFailure = { sqlState?: string; nativeCode?: number; stage: "resolve" | "tls" | "login" | "read" };

export function classifyProbeFailure(failure: ProbeFailure) {
  if (failure.stage === "tls") return "secure-transport-failed";
  if (failure.nativeCode === 18456 || failure.sqlState === "28000") return "authentication-refused";
  if (failure.nativeCode === 229 || failure.nativeCode === 916) return "permission-denied";
  if (failure.nativeCode === 1205 || failure.nativeCode === 1222 || failure.nativeCode === 8645) return "server-busy";
  if (failure.sqlState === "IM002" || failure.sqlState === "IM003") return "driver-unavailable";
  if (failure.sqlState === "HYT00" || failure.sqlState === "HYT01") return "timeout";
  if (failure.sqlState?.startsWith("08")) return "connection-interrupted";
  return "unknown";
}

export interface EngineMetadata {
  productVersion: string;
  edition: string;
  compatibilityLevel?: number;
}

export function assessEngine(metadata: EngineMetadata) {
  const generation = sqlGeneration(metadata.productVersion);
  if (!generation || !metadata.edition.trim()) return { generation, next: "verify-engine" } as const;
  switch (generation) {
    case "2000":
    case "2005":
      return { generation, next: "vendor-export" } as const;
    case "2008":
    case "2008 R2":
    case "2012":
    case "2014":
      return { generation, next: "verify-tls-patch-and-driver" } as const;
    default:
      return { generation, next: "verify-driver-channel-and-grant" } as const;
  }
}
