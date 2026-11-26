import { atLeast } from "../shared/bot-access.ts";
import { memberLevel, type AccessBot } from "./bot-visibility.ts";

export type WorkBotMember = { email: string; role: "owner" | "admin" | "member"; leftAt?: number };

export function mayDispatchWorkBot(team: boolean, member: WorkBotMember | undefined, from: AccessBot | null | undefined, to: AccessBot | null | undefined): boolean {
  if (!team) return true;
  if (!member || member.leftAt !== undefined || !from || !to) return false;
  return member.role !== "member" || (atLeast(memberLevel(from, member.email), "chat") && atLeast(memberLevel(to, member.email), "chat"));
}
