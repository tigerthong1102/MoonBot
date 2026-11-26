import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { Bot } from "@/state/store";
import { teamBotName, useTeamPeople } from "@/state/team-people";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { copyText } from "@/lib/clipboard-write";
import { registeredBotUsernames } from "../../shared/bot-username";

export function BotPickerList({
  bots,
  allBots,
  picked,
  onToggle,
  emptyHint,
  onSearchChange,
  hasOtherMatches = false,
}: {
  bots: Bot[];
  allBots: Bot[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  emptyHint: string;
  onSearchChange?: (query: string) => void;
  hasOtherMatches?: boolean;
}) {
  const team = useTeamPeople();
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const usernames = registeredBotUsernames(allBots);
  const visible = bots.filter(bot => !needle || teamBotName(bot, team).toLowerCase().includes(needle) || usernames.get(bot.id)?.includes(needle));
  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
      <input type="search" aria-label={t("cloudSend.choose.search")} placeholder={t("cloudSend.choose.search")} value={query} onChange={event => { setQuery(event.target.value); onSearchChange?.(event.target.value); }} onKeyDown={event => { if (event.key === "Enter" && !imeComposing(event.nativeEvent)) event.preventDefault(); }} className="rounded-lg bg-inset px-2 py-1.5 text-sm text-ink" />
      {visible.length === 0 && !hasOtherMatches && <div className="px-2 py-4 text-center text-[13px] text-ink-secondary">{needle ? t("chat.find.noResults") : emptyHint}</div>}
      {visible.map((b) => <div key={b.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onToggle(b.id)}
          role="checkbox"
          aria-label={`${teamBotName(b, team)}${usernames.has(b.id) ? ` @${usernames.get(b.id)}` : ""}`}
          aria-checked={picked.has(b.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised/50"
        >
          <BotAvatar bot={b} state="happy" size={28} animated={false} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] text-ink">{teamBotName(b, team)}</span>{usernames.has(b.id) && <span title={`@${usernames.get(b.id)}`} className="block break-all text-[12px] text-ink-secondary">@{usernames.get(b.id)}</span>}</span>
          <span
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded-full border",
              picked.has(b.id) ? "border-accent bg-accent text-white" : "border-hairline/60",
            )}
          >
            {picked.has(b.id) && <Check size={12} />}
          </span>
        </button>
        {usernames.has(b.id) && <button type="button" aria-label={`${t("common.copy")} @${usernames.get(b.id)}`} title={t("common.copy")} className="rounded-lg p-2 text-ink-secondary hover:bg-raised/50" onClick={() => { void copyText(`@${usernames.get(b.id)}`).then(result => setCopied({ id: b.id, ok: result === "copied" })); }}><Copy size={14} /></button>}
      </div>)}
      {copied && <span role="status" className="text-xs text-ink-secondary">{t(copied.ok ? "table.copied" : "common.copyFailed")}</span>}
    </div>
  );
}
