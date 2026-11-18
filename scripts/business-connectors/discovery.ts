const releases: Record<string, string> = {
  "8.0": "2000", "9.0": "2005", "10.0": "2008", "10.50": "2008 R2",
  "11.0": "2012", "12.0": "2014", "13.0": "2016", "14.0": "2017",
  "15.0": "2019", "16.0": "2022", "17.0": "2025",
};

export function sqlGeneration(version: string): string | null {
  if (!/^\d{1,2}\.\d{1,2}(?:\.\d{1,5}){0,2}$/.test(version)) return null;
  const [major, minor] = version.split(".").map(Number);
  return releases[[major, minor].join(".")] ?? null;
}

const instanceName = /^[a-z0-9_#$-]{1,16}$/i;
const numericVersion = /^\d{1,5}(?:\.\d{1,5}){0,3}$/;
const products = new Set(["smartpro", "misa-sme", "misa-mimosa", "ebh-pro", "ebh-basic",
  "ebh-edition-unknown", "fast-accounting", "sapo"]);
const driverName = /^(?:ODBC Driver (?:11|13|17|18) for SQL Server|SQL Native Client|SQL Server Native Client (?:10|11)\.0|SQL Server)$/i;
const knownIssues = new Set(["services", "instance-registry", "client-registry", "applications"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ServiceState = "running" | "stopped" | "other" | "unknown";

function serviceState(value: unknown): ServiceState {
  if (value === "Running") return "running";
  if (value === "Stopped") return "stopped";
  return "other";
}

export function interpretInventory(input: unknown) {
  if (!record(input) || input.schema !== 1 || !Array.isArray(input.observations) ||
      input.observations.length > 4096 || !Array.isArray(input.issues) ||
      !input.issues.every(issue => knownIssues.has(issue))) throw new Error("invalid-inventory");

  const issues = new Set<string>(input.issues);
  const instances = new Map<string, {
    name: string; state: ServiceState; sources: Set<string>; versions: Set<string>;
  }>();
  const applications = new Map<string, { product: string; version: string | null }>();
  const drivers = new Map<string, { name: string; view: string }>();
  let browser: ServiceState | "unobserved" = "unobserved";
  let localDbRuntimeObserved = false;
  for (const row of input.observations) {
    if (!record(row)) throw new Error("invalid-inventory");
    const view = row.view;
    if ((row.kind === "registry" || row.kind === "driver") && view !== "Registry32" && view !== "Registry64") {
      throw new Error("invalid-inventory");
    }
    if (row.kind === "localdb-runtime") {
      localDbRuntimeObserved = true;
      continue;
    }
    if (row.kind === "application") {
      if (typeof row.product !== "string" || !products.has(row.product)) throw new Error("invalid-inventory");
      const version = typeof row.version === "string" && numericVersion.test(row.version) ? row.version : null;
      applications.set([row.product, version].join("/"), { product: row.product, version });
      continue;
    }
    if (typeof row.name !== "string") throw new Error("invalid-inventory");
    const name = row.name.toUpperCase();
    if (row.kind === "driver") {
      if (!driverName.test(row.name)) throw new Error("invalid-inventory");
      drivers.set([name, view].join("/"), { name: row.name, view: String(view) });
      continue;
    }
    if (row.kind === "service" && name === "SQLBROWSER") {
      browser = serviceState(row.state);
      continue;
    }
    if (row.kind !== "registry" && row.kind !== "service") throw new Error("invalid-inventory");
    if (row.kind === "service" && name !== "MSSQLSERVER" && !name.startsWith("MSSQL$")) continue;
    const id = row.kind === "service" && name.startsWith("MSSQL$") ? name.slice(6) : name;
    if (!instanceName.test(id)) {
      issues.add(row.kind === "service" ? "services" : "instance-registry");
      continue;
    }
    const instance = instances.get(id) ?? {
      name: id, state: "unknown", sources: new Set<string>(), versions: new Set<string>(),
    };
    if (row.kind === "service") {
      instance.state = serviceState(row.state);
      instance.sources.add("service");
    } else {
      instance.sources.add(String(view));
      if (row.version) {
        if (typeof row.version === "string" && numericVersion.test(row.version)) instance.versions.add(row.version);
        else issues.add("instance-registry");
      }
    }
    instances.set(id, instance);
  }

  return {
    scope: "local-inventory", coverage: issues.size ? "partial" : "collected",
    issues: [...issues].sort(), browser, localDbRuntimeObserved,
    applications: [...applications.values()], drivers: [...drivers.values()],
    instances: [...instances.values()].map(instance => {
      const versions = [...instance.versions].sort();
      return { name: instance.name, serviceState: instance.state, sources: [...instance.sources].sort(),
        observedVersions: versions, versionConflict: versions.length > 1,
        generationHint: versions.length === 1 ? sqlGeneration(versions[0]) : null };
    }),
    connection: "untested",
  };
}
