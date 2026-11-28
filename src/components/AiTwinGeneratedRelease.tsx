import { generatedRoomLimit } from "../../electron/twin-generated-message.mjs";
import { useId, useState } from "react";
import { t } from "@/lib/i18n";
import { Select } from "./Select";

export function AiTwinGeneratedRelease({ paired }: { paired: boolean }) {
  const scopeId = useId();
  const durationId = useId();
  const bridge = window.ogb?.personalInbox;
  const [choices, setChoices] = useState<Awaited<ReturnType<NonNullable<NonNullable<typeof bridge>["generatedChoices"]>>>>();
  const [scope, setScope] = useState("selected");
  const [manageOnly, setManageOnly] = useState(false);
  const [ongoing, setOngoing] = useState(false);
  const [limit, setLimit] = useState("5");
  const [rooms, setRooms] = useState<string[]>([]);
  const [target, setTarget] = useState<{owner:string;id:string}>();
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  if (!bridge?.generatedChoices || !bridge.offerGenerated || !bridge.generatedStatus || !bridge.stopGenerated) return null;
  const refs = scope === "selected" ? rooms : scope === "all" ? ["all-direct","all-managed-groups"] : [scope];
  const dailyLimit = Number(limit);
  const validLimit = !ongoing || (Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 720);
  async function run(action: "choose" | "offer" | "status" | "stop") {
    setBusy(true);
    try {
      if (action === "offer") {
        if (!choices || !validLimit) return;
        const accepted = ongoing ? await bridge!.offerGenerated!(choices.provider, refs, dailyLimit)
          : await bridge!.offerGenerated!(choices.provider, refs);
        if (!accepted) return;
      }
      if (action === "stop") setNote(t("personalInbox.exactStopping"));
      const state = action === "stop" ? await bridge!.stopGenerated!(target) : await bridge!.generatedStatus!();
      setManageOnly(state.manageOnly === true);
      setTarget(state.owner && state.remote ? {owner:state.owner,id:state.remote.id} : undefined);
      if (action === "choose" && state.available && !state.remote && !state.manageOnly && !state.pendingRecovery) {
        setChoices(await bridge!.generatedChoices!());
        setRooms([]);
        setScope("selected");
        setOngoing(false);
        setLimit("5");
        setNote("");
        return;
      }
      if (state.remote || action === "stop") setChoices(undefined);
      if (state.remote?.enabled && state.remote.dailyLimit !== undefined) {
        const active = state.remote.leaseActive && !state.manageOnly;
        const status = t(state.manageOnly ? "personalInbox.generatedManageOnly" : active ? "personalInbox.generatedOngoingEnabled" : "personalInbox.generatedOngoingWaiting", {count:state.remote.dailyLimit});
        const usage = state.remote.usedToday !== undefined ? t("personalInbox.generatedUsage", { recent:state.remote.count, today:state.remote.usedToday, count:state.remote.dailyLimit }) : "";
        setNote([status, usage].filter(Boolean).join(" "));
        return;
      }
      setNote(t(state.pendingRecovery ? "personalInbox.exactStopping" : !state.available ? "personalInbox.exactUnavailable" :
        !state.remote ? "personalInbox.generatedOff" : state.remote.enabled ? "personalInbox.generatedEnabled" : "personalInbox.generatedPending"));
    } catch {
      setChoices(undefined);
      setNote(t(action === "stop" ? "personalInbox.exactStopping" : "personalInbox.exactUnavailable"));
    } finally { setBusy(false); }
  }
  return <details data-generated-release>
    <summary>{t("personalInbox.generatedTitle")}</summary>
    <p>{t("personalInbox.generatedTerms")}</p>
    <fieldset disabled={busy}>
      {paired && !manageOnly && !target && <button type="button" className="ui-button" onClick={() => void run("choose")}>{t("personalInbox.generatedChoose")}</button>}
      {paired && !manageOnly && !target && choices && <>
        <p dir="auto">{choices.provider.name} · {choices.provider.model} · {choices.provider.destination}</p>
        <div className="grid gap-1">
          <label htmlFor={scopeId}>{t("personalInbox.generatedScope")}</label>
          <Select id={scopeId} value={scope} onChange={e => setScope(e.target.value)}>
            <option value="selected">{t("personalInbox.generatedSelected")}</option>
            <option value="all-direct">{t("personalInbox.generatedAllDirect")}</option>
            <option value="all-managed-groups">{t("personalInbox.generatedAllGroups")}</option>
            <option value="all">{t("personalInbox.generatedAllRooms")}</option>
          </Select>
        </div>
        {scope === "selected" && choices.rooms.map(room => <label className="block" key={room.ref}>
          <input type="checkbox" disabled={rooms.length >= generatedRoomLimit && !rooms.includes(room.ref)} checked={rooms.includes(room.ref)} onChange={e => {
            const checked = e.target.checked;
            setRooms(old => {
              if (!checked) return old.filter(ref => ref !== room.ref);
              if (old.length >= generatedRoomLimit || old.includes(room.ref)) return old;
              return [...old, room.ref];
            });
          }} /> {room.title} ({t(room.kind === "group" ? "personalInbox.group" : "personalInbox.direct")} · {room.id})
        </label>)}
        <div className="grid gap-1">
          <label htmlFor={durationId}>{t("personalInbox.generatedDuration")}</label>
          <Select id={durationId} data-duration value={ongoing ? "online" : "once"} onChange={e => setOngoing(e.target.value === "online")}>
            <option value="once">{t("personalInbox.generatedOnce")}</option>
            <option value="online">{t("personalInbox.generatedWhileOnline")}</option>
          </Select>
        </div>
        {ongoing && <>
          <label>{t("personalInbox.generatedDailyLimit")} <input type="number" min={1} max={720} value={limit} onChange={e => setLimit(e.target.value)} /></label>
          {validLimit && <p>{t("personalInbox.generatedOngoingTerms", { count: dailyLimit })}</p>}
        </>}
        <button type="button" className="ui-button" disabled={!refs.length || !validLimit} onClick={() => void run("offer")}>{t("personalInbox.generatedOffer")}</button>
      </>}
      <button type="button" className="ui-button" onClick={() => void run("status")}>{t("personalInbox.exactCheck")}</button>
      <button type="button" className="ui-button" onClick={() => void run("stop")}>{t("personalInbox.generatedStop")}</button>
    </fieldset>
    <p role="status">{note}</p>
    {target && <p>{t("personalInbox.generatedChange")}</p>}
  </details>;
}
