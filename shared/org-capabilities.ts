import type { PackageDocument } from "./package-format.ts";

export interface OrgCapabilityReview {
  base: string;
  target: string;
  added: string[];
  removed: string[];
  baselineMissing: boolean;
}

function packageCapabilities(document: PackageDocument): Set<string> {
  const pkg = document.package;
  return new Set([
    ...pkg.requirements.capabilities.map(capability => "Capability · " + capability),
    ...pkg.requirements.apps.map(app => "App · " + app.slug + (app.optional ? " (optional)" : "")),
    ...(pkg.connections ?? []).flatMap(connection => [
      "MCP · " + connection.key + " · " + connection.mcp.transport + " · " + connection.mcp.url,
      ...connection.mcp.valueNames.map(name => "MCP header · " + connection.key + " · " + name.toLowerCase()),
    ]),
  ]);
}

export function capabilityReview(previous: PackageDocument | null, next: PackageDocument, base: string, target: string): OrgCapabilityReview | null {
  const old = previous ? packageCapabilities(previous) : new Set<string>();
  const current = packageCapabilities(next);
  const added = [...current].filter(value => !old.has(value)).sort();
  const removed = [...old].filter(value => !current.has(value)).sort();
  return !previous || added.length ? { base, target, added, removed, baselineMissing: !previous } : null;
}

export function newerRelease(candidate: string, installed: string): boolean {
  const versions = [candidate, installed].map(version => version.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const change = versions[0]![i]! - versions[1]![i]!;
    if (change) return change > 0;
  }
  return false;
}
