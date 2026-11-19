import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { WorkBotIcon } from "../shared/team-setup.ts";
import { redactSecretsInText } from "./redact.ts";
import { saveImage } from "./attachments.ts";
import { nativeRequire } from "./data/engine.ts";

export function workBotName(topic: string, bots: ReadonlyArray<{ name: string }>): string {
  const base = [...topic.normalize("NFC").trim().replace(/\s+/gu, " ")].slice(0, 28).join("").trimEnd();
  const taken = new Set(bots.map(bot => bot.name.normalize("NFC").trim().toLowerCase()));
  let name = base;
  for (let number = 2; taken.has(name.toLowerCase()); number++) name = `${base} ${number}`;
  return name;
}

const shapes: Record<WorkBotIcon, string> = {
  ledger: '<rect x="22" y="13" width="40" height="54" rx="4"/><path d="M32 13v54m8-38h13m-13 9h13m-13 9h13"/>',
  chart: '<path d="M16 16v48h50m-40-12V41m13 11V33m13 19V22"/>',
  calendar: '<rect x="15" y="21" width="50" height="44" rx="5"/><path d="M15 33h50M27 15v13m26-13v13m-28 18h7m9 0h7m-23 9h7"/>',
  mail: '<rect x="13" y="22" width="54" height="39" rx="5"/><path d="m16 25 24 19 24-19"/>',
  tasks: '<path d="m14 25 5 5 10-12m8 8h26M14 44l5 5 10-12m8 8h26m-26 16h26"/>',
  box: '<path d="m40 12 25 13v29L40 68 15 54V25zm0 28L15 25m25 15 25-15M40 40v28M27 18l25 14"/>',
};

export function workBotAvatar(icon: WorkBotIcon, botId: string): string {
  const hue = createHash("sha256").update(botId).digest().readUInt16BE() % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 80 80"><rect width="80" height="80" rx="14" fill="hsl(${hue},55%,34%)"/><g fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${shapes[icon]}</g></svg>`;
  const { Resvg } = nativeRequire()("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
  const saved = saveImage(Buffer.from(new Resvg(svg).render().asPng()), "image/png", botId);
  return `/api/attachments/${basename(saved.path)}`;
}

const TOPICS: ReadonlyArray<{ match: RegExp; vi: string; en: string; icon: WorkBotIcon }> = [
  { match: /\b(hoa don|cong no|doi soat|invoices?|reconciliation|receivables?)\b/, vi: "Đối soát hóa đơn", en: "Invoice tracking", icon: "ledger" },
  { match: /\b(kiem kho|ton kho|stock levels?|inventory)\b/, vi: "Kiểm kho", en: "Inventory", icon: "box" },
  { match: /\b(khach hang|doanh so|kinh doanh|leads?|sales|customers?)\b/, vi: "Theo dõi khách hàng", en: "Sales follow-up", icon: "chart" },
  { match: /\b(noi dung|chien dich|marketing|content|campaigns?)\b/, vi: "Lịch nội dung", en: "Content calendar", icon: "calendar" },
  { match: /\b(email|thu den|hop thu|inbox)\b/, vi: "Theo dõi email", en: "Inbox follow-up", icon: "mail" },
];
const tracking = /\b(theo doi|quan ly|len ke hoach|lap ke hoach|chuan bi|doi soat|len lich|tong hop|track|tracking|monitor|organize|manage|schedule|plan|prepare|reconcile)\b/;
const recurring = /\b(hang (ngay|tuan|thang)|moi (ngay|tuan|thang)|dinh ky|daily|weekly|monthly|every (day|week|month))\b/;
const business = /\b(tuyen dung|ung tuyen|ung vien|nhan vien|don hang|giao hang|van chuyen|san xuat|hop dong|bao gia|tai lieu|nghien cuu|ho so|cong trinh|su kien|bao cao|chi phi|doi tac|nha cung cap|doanh nghiep|recruitment|applicants?|candidates?|orders?|shipments?|contracts?|events?|reports?|expenses?|suppliers?|vendors?)\b/;
const project = /\b(du an|tien do|cong viec|project|progress|milestones?|deliverables?)\b/;

export function workBotTopic(text: string, firstSpecialist = false): { name: string; icon: WorkBotIcon; instructions: string } | null {
  if (text.length > 1600) return null;
  const line = redactSecretsInText(text).trim();
  if (!line || /[\n`]/.test(line) || /https?:\/\//i.test(line)) return null;
  const words = line.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");
  if (/\b(bot|tro ly|what is|what are|la gi|nghia la|khong (?:can|muon|theo doi)|dung (?:theo doi|tao)|do not|don't|stop (?:tracking|monitoring))\b/.test(words)) return null;
  const firstAssignment = firstSpecialist && /\b(tao|viet|soan|lap|kiem tra|ra soat|draft|write|review|create|audit)\b/.test(words);
  if (!tracking.test(words) && !recurring.test(words) && !firstAssignment) return null;
  const topic = TOPICS.find(option => option.match.test(words));
  if (!topic && !project.test(words) && !business.test(words)) return null;
  const vietnamese = /\b(toi|minh|theo doi|du an|quan ly|hang tuan|moi tuan|giup|hoa don|kiem kho|lich|cong viec)\b/.test(words) || /[ăâêôơưđ]/i.test(line);
  const namedProject = /(?:dự án|du an|project)\s+["“]([^"”]{2,60})["”]/iu.exec(line)?.[1];
  const customSubject = /(?:theo dõi|theo doi|quản lý|quan ly|track|monitor|manage)\s+(?:(?:các|việc|the|our)\s+)?([^.!?;,:\n]+)/iu.exec(line)?.[1]
    ?.split(/\s+(?:mỗi|hàng|định kỳ|moi|hang|every|daily|weekly|monthly)\b/iu)[0]?.trim();
  const customName = namedProject ?? (!topic ? customSubject : undefined);
  const name = customName ? workBotName(customName[0]!.toUpperCase() + customName.slice(1), []) :
    topic ? (vietnamese ? topic.vi : topic.en) : (vietnamese ? "Tiến độ công việc" : "Work progress");
  const instructions = vietnamese
    ? `Giúp người dùng theo dõi công việc được mô tả dưới đây. Hỏi lại những chi tiết còn thiếu.\n\n${line}`
    : `Help the person follow the work described below. Ask for any missing details.\n\n${line}`;
  return { name, icon: topic?.icon ?? "tasks", instructions };
}
