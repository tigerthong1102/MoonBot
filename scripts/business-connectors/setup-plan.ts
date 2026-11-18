import { sqlGeneration } from "./discovery.ts";

const choices = {
  consent: ["granted", "denied"],
  data: ["sql", "cloud", "other", "unknown"],
  location: ["local", "lan", "unknown"],
  engine: ["running", "stopped", "absent", "unknown"],
  access: ["granted", "denied", "unknown"],
  driver: ["compatible", "incompatible", "unknown"],
  channel: ["verified", "unsafe", "unknown"],
  database: ["identified", "missing", "unknown"],
  vendor: ["existing", "new-required", "legacy-only", "unknown"],
  installation: ["requested", "declined", "unknown"],
} as const;

const certifiedTargets = ["2019", "2022", "2025"] as const;

type Evidence = { [K in keyof typeof choices]: typeof choices[K][number] } & {
  observedVersion?: string; certifiedTarget?: typeof certifiedTargets[number];
  checks?: Partial<Record<typeof checks[number], boolean>>;
  smartPro2005Lab?: Partial<Record<typeof labChecks[number], boolean>>;
};
const checks = ["localHostConfirmed", "hardwareAndOs", "adminAvailable", "license",
  "officialInstaller", "signature", "independentChecksum", "instanceNameAvailable", "recoveryPlan"] as const;

const labChecks = ["disposableVm", "networkDisconnected", "cleanSnapshot", "syntheticDataOnly", "smartProBuildConfirmed"] as const;

function validChecks(raw: unknown, keys: readonly string[]) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
    Object.entries(raw).every(([key, value]) => keys.includes(key) && typeof value === "boolean");
}

function validate(raw: unknown): Evidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid-evidence");
  const obj = raw as Record<string, unknown>;
  for (const [key, values] of Object.entries(choices)) {
    if (!(values as readonly unknown[]).includes(obj[key])) throw new Error("invalid-evidence");
  }
  if (obj.observedVersion !== undefined && (typeof obj.observedVersion !== "string" || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,5}){0,2}$/.test(obj.observedVersion))) throw new Error("invalid-evidence");
  if (obj.certifiedTarget !== undefined && !certifiedTargets.some(target => target === obj.certifiedTarget)) throw new Error("invalid-evidence");
  if (obj.checks !== undefined && !validChecks(obj.checks, checks)) throw new Error("invalid-evidence");
  if (obj.smartPro2005Lab !== undefined &&
      (!validChecks(obj.smartPro2005Lab, labChecks) || obj.certifiedTarget !== undefined)) throw new Error("invalid-evidence");
  return obj as Evidence;
}

export function setupPlan(raw: unknown) {
  const e = validate(raw);
  const plan = (scenario: string, next: string, missing: string[] = []) => ({ mode: "dry-run", scenario, next, missing });
  if (e.consent !== "granted") return plan("STOP", "Dừng theo lựa chọn của người dùng.");
  if (e.data === "unknown") return plan("UNKNOWN", "Xác minh sản phẩm và cơ sở dữ liệu theo đúng phiên bản.");
  if (e.data !== "sql") return plan("G", "Dùng API được cấp quyền hoặc file xuất của hãng.");
  if (e.smartPro2005Lab) {
    if (e.installation !== "requested") return plan("STOP", "Chỉ lập kế hoạch cài lab khi người vận hành yêu cầu.");
    if (e.location !== "local" || e.engine !== "absent" || e.observedVersion || e.access !== "unknown" ||
        e.database === "identified" || e.channel !== "unknown" || e.driver === "incompatible" ||
        (e.vendor !== "new-required" && e.vendor !== "legacy-only")) {
      return plan("STOP", "Xác minh máy ảo trống dành riêng cho Smart Pro. Nếu đã có máy chủ dữ liệu, khảo sát instance hiện hữu.");
    }
    const missing = [...checks.filter(key => e.checks?.[key] !== true),
      ...labChecks.filter(key => e.smartPro2005Lab?.[key] !== true)];
    if (missing.length) return plan("LAB_2005_PENDING", "Bổ sung bằng chứng cho máy thử và bộ cài SQL Server 2005.", missing);
    return plan("LAB_2005_MANUAL", "Người vận hành có thể mở bộ cài SQL Server 2005 đã xác minh trong máy ảo Smart Pro cô lập.");
  }
  if (e.vendor === "legacy-only") return plan("J", "Xin báo cáo xuất hoặc lập kế hoạch migration cùng hãng.");
  const generation = e.observedVersion && sqlGeneration(e.observedVersion);
  if (e.channel === "unsafe" || generation === "2000" || generation === "2005") return plan("I", "Dùng file xuất chính thức. Đường kết nối legacy cần lab riêng.");
  if (e.access === "denied") return plan("D", "Nhờ DBA xác nhận tài khoản chỉ đọc đúng công ty.");
  if (e.driver === "incompatible") return plan("E", "Đối chiếu build driver, bitness và phiên bản engine.");
  if (e.engine === "running" && e.database === "missing") return plan("H", "Nhờ DBA hoặc hãng xác định database và bản sao lưu.");
  if (e.location === "lan") return plan("C", "Kiểm tra endpoint máy chủ đã được duyệt và cổng do DBA xác nhận.");
  if (e.location !== "local") return plan("UNKNOWN", "Xác định máy chứa dữ liệu trong ứng dụng gốc.");
  if (e.engine === "stopped") return plan("B", "Báo người vận hành kiểm tra service đang dừng.");
  if (e.engine === "running") return plan("A", "Xác minh metadata, kênh truyền, quyền và công ty trước phép đọc.");
  if (e.engine !== "absent" || e.vendor !== "new-required" || e.observedVersion || e.database === "identified" || e.access === "granted") return plan("UNKNOWN", "Xác nhận nhu cầu instance mới và loại trừ server đang dùng.");
  if (e.installation === "declined") return plan("F", "Người dùng đã từ chối cài đặt.");
  const missing: string[] = checks.filter(key => e.checks?.[key] !== true);
  if (!e.certifiedTarget) missing.push("certifiedTarget");
  if (e.installation !== "requested") missing.push("installationRequested");
  if (missing.length) return plan("F", "Chưa đủ bằng chứng để trình kế hoạch cài đặt.", missing);
  return plan("F", "Trình kế hoạch cài SQL Server " + e.certifiedTarget + " để người có thẩm quyền duyệt.");
}
