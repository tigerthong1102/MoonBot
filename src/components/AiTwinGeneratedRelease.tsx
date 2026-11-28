import { generatedRoomLimit } from "../../electron/twin-generated-message.mjs";
import { useState } from "react";
import { t } from "@/lib/i18n";

export function AiTwinGeneratedRelease({ paired }: { paired: boolean }) {
  const bridge = window.ogb?.personalInbox;
  const [choices, setChoices] = useState<Awaited<ReturnType<NonNullable<NonNullable<typeof bridge>["generatedChoices"]>>>>();
  const [scope, setScope] = useState("selected");
  const [rooms, setRooms] = useState<string[]>([]);
  const [target, setTarget] = useState<{owner:string;id:string}>();
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  if (!bridge?.generatedChoices || !bridge.offerGenerated || !bridge.generatedStatus || !bridge.stopGenerated) return null;
  const refs = scope === "selected" ? rooms : scope === "all" ? ["all-direct","all-managed-groups"] : [scope];
  async function run(action: "choose" | "offer" | "status" | "stop") {
    setBusy(true);
    try {
      if (action === "choose") {
        setChoices(await bridge!.generatedChoices!());
        setRooms([]);
        setScope("selected");
        setNote("");
        return;
      }
      if (action === "offer" && (!choices || !await bridge!.offerGenerated!(choices.provider, refs))) return;
      if (action === "stop") setNote(t("personalInbox.exactStopping"));
      const state = action === "stop" ? await bridge!.stopGenerated!(target) : await bridge!.generatedStatus!();
      setTarget(state.owner && state.remote ? {owner:state.owner,id:state.remote.id} : undefined);
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
      {paired && <button type="button" className="ui-button" onClick={() => void run("choose")}>{t("personalInbox.generatedChoose")}</button>}
      {paired && choices && <>
        <p dir="auto">{choices.provider.name} · {choices.provider.model} · {choices.provider.destination}</p>
        <label>{t("personalInbox.generatedScope")}
          <select value={scope} onChange={e => setScope(e.target.value)}>
            <option value="selected">{t("personalInbox.generatedSelected")}</option>
            <option value="all-direct">{t("personalInbox.generatedAllDirect")}</option>
            <option value="all-managed-groups">{t("personalInbox.generatedAllGroups")}</option>
            <option value="all">{t("personalInbox.generatedAllRooms")}</option>
          </select>
        </label>
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
        <button type="button" className="ui-button" disabled={!refs.length} onClick={() => void run("offer")}>{t("personalInbox.generatedOffer")}</button>
      </>}
      <button type="button" className="ui-button" onClick={() => void run("status")}>{t("personalInbox.exactCheck")}</button>
      <button type="button" className="ui-button" onClick={() => void run("stop")}>{t("personalInbox.generatedStop")}</button>
    </fieldset>
    <p role="status">{note}</p>
  </details>;
}
