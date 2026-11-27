import { useEffect, useRef, useState } from "react";
import { Select } from "./Select";
import { t } from "@/lib/i18n";

type Bridge = { list(): Promise<{ id: string; name: string }[]>; read(id: string): Promise<string>; send(id: string, text: string): Promise<void> };
export function LocalTerminalPane({ bridge }: { bridge: Bridge }) {
  const [open, setOpen] = useState(false);
  const [panes, setPanes] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [output, setOutput] = useState("");
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const items = await bridge.list();
        if (!alive) return;
        setPanes(items);
        const id = selected || items[0]?.id;
        if (id && items.some(item => item.id === id)) {
          const text = await bridge.read(id);
          if (alive) { setSelected(id); setOutput(text); }
        } else if (alive) { setOutput(""); setSelected(""); setLine(""); }
      } catch { if (alive) { setOutput(""); setError(true); } }
      finally { if (alive) timer = setTimeout(() => void refresh(), 1500); }
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [bridge, open, selected]);
  const text = query ? output.split("\n").filter(row => row.toLowerCase().includes(query.toLowerCase())).join("\n") : output;
  return <details className="mt-3 rounded-xl bg-card p-3 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">{t("terminal.local.title")}</summary>
    {open && <div className="mt-3 grid gap-2">
      {panes.length === 0 ? <p>{t("terminal.local.empty")}</p> : <>
        <Select aria-label={t("terminal.local.select")} value={selected} disabled={sending} onChange={event => { setSelected(event.target.value); setOutput(""); setLine(""); setError(false); }}>
          {panes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <input type="search" value={query} aria-label={t("terminal.local.search")} placeholder={t("terminal.local.search")} onChange={event => setQuery(event.target.value)} />
        <pre tabIndex={0} className="max-h-64 select-text overflow-auto rounded-md bg-inset p-2 font-mono text-xs">{text}</pre>
        <form className="flex gap-2" onSubmit={async event => {
          event.preventDefault();
          if (!selected || !line || inFlight.current) return;
          inFlight.current = true; setSending(true); setError(false);
          try { await bridge.send(selected, line); setLine(""); }
          catch { setError(true); }
          finally { inFlight.current = false; setSending(false); }
        }}>
          <input className="min-w-0 flex-1" value={line} maxLength={4096} disabled={sending} aria-label={t("terminal.local.input")} placeholder={t("terminal.local.input")} onChange={event => setLine(event.target.value)} />
          <button type="submit" disabled={!selected || !line || sending}>{t("terminal.local.send")}</button>
        </form>
      </>}
      {error && <p role="alert">{t("terminal.local.error")}</p>}
    </div>}
  </details>;
}
