import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { Select } from "./Select";

interface Device { name: string; udid: string; runtime: string }
interface Capture { device: Device; at: string; png: string }
type Bridge = { list(): Promise<Device[]>; capture(id: string): Promise<Capture> };

export function LocalSimulatorPane({ bridge }: { bridge: Bridge }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState("");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  async function load(takeScreenshot: boolean) {
    const version = ++generation.current;
    setBusy(true); setError(false); setCapture(null);
    try {
      if (takeScreenshot) {
        const image = await bridge.capture(selected);
        if (version === generation.current && image.device.udid === selected) setCapture(image);
      } else {
        const items = await bridge.list();
        if (version === generation.current) { setDevices(items); setSelected(items.some(item => item.udid === selected) ? selected : items[0]?.udid ?? ""); }
      }
    } catch { if (version === generation.current) setError(true); }
    finally { if (version === generation.current) setBusy(false); }
  }
  return <details className="mt-3 rounded-xl bg-card p-3 text-sm" onToggle={event => {
    if (event.currentTarget.open) void load(false);
    else { ++generation.current; setCapture(null); }
  }}>
    <summary className="cursor-pointer font-medium">{t("simulator.local.title")}</summary>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {devices.length > 0 && <Select disabled={busy} aria-label={t("simulator.local.device")} value={selected} onChange={event => { setSelected(event.target.value); setCapture(null); }}>
        {devices.map(d => <option key={d.udid} value={d.udid}>{d.name} · {d.runtime.split(".").at(-1)}</option>)}
      </Select>}
      <button disabled={busy} onClick={() => void load(false)}>{t("simulator.local.refresh")}</button>
      {selected && <button disabled={busy} onClick={() => void load(true)}>{t("simulator.local.capture")}</button>}
    </div>
    {error ? <p role="alert">{t("simulator.local.error")}</p> : !busy && !selected && <p>{t("simulator.local.empty")}</p>}
    {capture && <figure className="mt-2">
      <img src={"data:image/png;base64," + capture.png} alt={capture.device.name} className="max-h-80 max-w-full object-contain" />
      <figcaption>{capture.device.name} · {new Date(capture.at).toLocaleString()}</figcaption>
      <a download={"startupbot-" + capture.device.udid + ".png"} href={"data:image/png;base64," + capture.png}>{t("simulator.local.save")}</a>
    </figure>}
  </details>;
}
