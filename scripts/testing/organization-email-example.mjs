import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID } from "node:crypto";

const employee = "employee@example.test";
const organization = { id: randomUUID(), name: "StartupBot Demo" };
const secret = () => randomBytes(32).toString("base64url");
let attempt;
let grant;
let origin;
const server = createServer(async (req, res) => {
  function reply(status, value) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  }
  if (req.headers.host !== new URL(origin).host || req.headers.origin) return reply(403, { error: "forbidden" });
  if (req.method === "GET" && req.url === "/api/public/config")
    return reply(200, { desktopContractVersion: 1, capabilities: { desktopEnrollment: true, desktopEmailOtp: true } });
  if (req.url === "/api/desktop/session") {
    if (!grant || grant.device.expiresAt <= Date.now() || req.headers.authorization !== "Bearer " + grant.accessToken)
      return reply(401, { error: "invalid_token" });
    if (req.method === "DELETE") { grant = null; return reply(200, { revoked: true }); }
    if (req.method === "GET") return reply(200, { desktopContractVersion: 1, organization, device: grant.device,
      modelAccessToken: grant.modelToken, cloudBackups: false, providers: [] });
  }
  if (req.method !== "POST") return reply(404, { error: "not_found" });
  let body = "";
  for await (const chunk of req) {
    if (Buffer.byteLength(body) + chunk.length > 4096) return reply(413, { error: "invalid_request" });
    body += chunk;
  }
  let data;
  try { data = JSON.parse(body); } catch { return reply(400, { error: "invalid_request" }); }
  if (!data || typeof data !== "object") return reply(400, { error: "invalid_request" });
  if (req.url === "/api/desktop/enrollment") {
    const userCode = Array.from({ length: 10 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("").replace(/^(.{5})/, "$1-");
    attempt = { deviceCode: secret(), expires: Date.now() + 600000, tries: 0, approved: false, lastSend: 0 };
    return reply(201, { deviceCode: attempt.deviceCode, userCode, verificationUriComplete: origin + "/enroll?code=" + userCode, expiresIn: 600, interval: 5 });
  }
  if (!attempt || data.deviceCode !== attempt.deviceCode || attempt.expires <= Date.now()) return reply(400, { error: "expired_token" });
  if (req.url === "/api/desktop/enrollment/email/send") {
    if (Date.now() - attempt.lastSend < 60000) return reply(429, { error: "rate_limited" });
    attempt.lastSend = Date.now();
    if (data.email === employee && !attempt.approved && attempt.tries < 5) {
      attempt.otp = String(randomInt(100000000)).padStart(8, "0");
      console.log("Mã hộp thư mô phỏng " + employee + " · " + attempt.otp);
    }
    return reply(200, { ok: true });
  }
  if (req.url === "/api/desktop/enrollment/email/verify") {
    if (++attempt.tries > 5 || data.email !== employee || !attempt.otp || data.code !== attempt.otp)
      return reply(401, { error: "invalid_code" });
    attempt.otp = null; attempt.approved = true; return reply(200, { ok: true });
  }
  if (req.url === "/api/desktop/enrollment/token") {
    if (!attempt.approved) return reply(400, { error: "authorization_pending" });
    attempt = null;
    const device = { id: randomUUID(), organizationId: organization.id, email: employee, revokedAt: null, expiresAt: Date.now() + 3600000 };
    grant = { device, accessToken: "omd_" + secret(), modelToken: "omg_" + secret() };
    return reply(200, { accessToken: grant.accessToken, expiresAt: device.expiresAt, device });
  }
  return reply(404, { error: "not_found" });
});
server.listen(0, "127.0.0.1", () => {
  origin = "http://127.0.0.1:" + server.address().port;
  console.log("Portal tổ chức thử nghiệm · " + origin + "\nEmail nhân viên mẫu · " + employee);
});
