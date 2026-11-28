import { useState } from "react";
import { t } from "@/lib/i18n";

export function AiTwinExactRelease({ paired }: { paired: boolean }) {
  const bridge = window.ogb?.personalInbox;
  const [choices, setChoices] =
    useState<Awaited<ReturnType<NonNullable<NonNullable<typeof bridge>["exactChoices"]>>>>();
  const [lesson, setLesson] = useState(""),
    [rooms, setRooms] = useState<string[]>([]),
    [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const [target, setTarget] = useState<{ owner: string; id: string }>();
  if (!bridge?.exactChoices || !bridge.offerExact || !bridge.stopExact) return null;
  async function run(action: "load" | "offer" | "off" | "status") {
    setBusy(true);
    try {
      if (action === "load") {
        setChoices(await bridge!.exactChoices!());
        setRooms([]);
        setAll(false);
        setLesson("");
        setNote("");
      }
      if (action === "offer") {
        if (await bridge!.offerExact!(lesson, all ? ["*"] : rooms)) {
          const state = await bridge!.exactStatus!();
          setTarget(state.owner && state.remote ? { owner: state.owner, id: state.remote.id } : undefined);
          setNote(t("personalInbox.exactPending"));
        }
      }
      if (action === "off" || action === "status") {
        if (action === "off") setNote(t("personalInbox.exactStopping"));
        const state = action === "off" ? await bridge!.stopExact!(target) : await bridge!.exactStatus!();
        if (state.pendingRecovery) {
          setNote(t("personalInbox.exactStopping"));
          return;
        }
        if (!state.available) throw Error("unavailable");
        setTarget(state.owner && state.remote ? { owner: state.owner, id: state.remote.id } : undefined);
        setNote(
          t(
            state.remote?.enabled
              ? "personalInbox.exactEnabled"
              : state.remote
                ? "personalInbox.exactPending"
                : "personalInbox.exactOff",
          ) + (state.remote ? " · " + new Date(state.remote.expires).toLocaleString() : ""),
        );
      }
    } catch {
      setNote(t(action === "off" ? "personalInbox.exactStopping" : "personalInbox.exactUnavailable"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void run("status");
      }}
    >
      <summary>{t("personalInbox.exactTitle")}</summary>
      <p>{t("personalInbox.exactConsent")}</p>
      <p>{t("personalInbox.exactRetention")}</p>
      <button type="button" className="ui-button" disabled={busy || !paired} onClick={() => void run("load")}>
        {t("personalInbox.exactChoose")}
      </button>
      {choices && (
        <fieldset disabled={busy}>
          <label>
            {t("personalInbox.exactLesson")}{" "}
            <select value={lesson} onChange={(e) => setLesson(e.target.value)}>
              <option value="">—</option>
              {choices.lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.question}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{" "}
            {t("personalInbox.exactAll")}
          </label>
          {choices.rooms
            .filter((r) => r.title)
            .map((r) => (
              <label className="block" key={r.ref}>
                <input
                  type="checkbox"
                  disabled={all}
                  checked={!all && rooms.includes(r.ref)}
                  onChange={(e) =>
                    setRooms((old) => (e.target.checked ? [...old, r.ref] : old.filter((id) => id !== r.ref)))
                  }
                />{" "}
                {r.title} ({t(r.kind === "group" ? "personalInbox.group" : "personalInbox.direct")} · {r.id})
              </label>
            ))}
          <button
            type="button"
            className="ui-button"
            disabled={!lesson || (!all && !rooms.length)}
            onClick={() => void run("offer")}
          >
            {t("personalInbox.exactOffer")}
          </button>
        </fieldset>
      )}
      <button type="button" className="ui-button" disabled={busy} onClick={() => void run("off")}>
        {t("personalInbox.exactStop")}
      </button>
      <button type="button" className="ui-button" disabled={busy} onClick={() => void run("status")}>
        {t("personalInbox.exactCheck")}
      </button>
      <p role="status">{note}</p>
    </details>
  );
}
