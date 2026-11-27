import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { MAX_MANIFEST_BYTES, readPanelManifest, type PanelManifest } from "@/lib/panel-plugins/manifest";

export function LocalPluginPanels() {
  const [plugins, setPlugins] = useState<PanelManifest[]>([]);
  const [failed, setFailed] = useState(false);
  const selection = useRef(0);
  async function open(file: File | undefined) {
    if (!file) return;
    const token = ++selection.current;
    try {
      if (file.size > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
      const next = readPanelManifest(await file.text());
      if (token !== selection.current) return;
      if (plugins.length >= 8 && !plugins.some((item) => item.id === next.id)) throw new Error("catalog-full");
      setPlugins((previous) => [...previous.filter((item) => item.id !== next.id), next]);
      setFailed(false);
    } catch {
      if (token === selection.current) setFailed(true);
    }
  }
  return (
    <details className="mt-5 px-2 pb-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("apps.localPanels.title")}</summary>
      <label className="mt-3 flex flex-wrap items-center gap-2">{t("apps.localPanels.open")}
        <input type="file" accept=".json,application/json" onChange={(event) => {
          void open(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }} />
      </label>
      {failed && <p role="alert" className="mt-2 text-warning">{t("apps.localPanels.invalid")}</p>}
      {plugins.map((plugin) => (
        <section key={plugin.id} className="my-3 rounded-xl bg-control/50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="break-words font-medium">{plugin.name} · {plugin.version}</h3>
            <button type="button" onClick={() => setPlugins((items) => items.filter((item) => item.id !== plugin.id))}>{t("apps.localPanels.remove")}</button>
          </div>
          {plugin.contributes.panels.map((panel) => (
            <section key={panel.id} className="mt-3">
              <h4 className="font-medium">{panel.title}</h4>
              <dl>{panel.rows.map((row, index) => <div key={index} className="grid grid-cols-2 gap-2 border-t border-hairline/40 py-1"><dt className="break-words text-ink-secondary">{row.label}</dt><dd className="whitespace-pre-wrap break-words">{row.value}</dd></div>)}</dl>
            </section>
          ))}
        </section>
      ))}
    </details>
  );
}
