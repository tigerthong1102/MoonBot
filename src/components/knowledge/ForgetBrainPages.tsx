import { useState } from "react";
import { t } from "@/lib/i18n";
import { ConfirmDialog } from "../ConfirmDialog";
import { forgetBrainPages } from "./brain-erasure";
import type { BrainPage } from "./brain";

export function ForgetBrainPages({ owner, page, signal, changed, failed }: {
  owner: string; page: BrainPage | null; signal: AbortSignal; changed: () => void; failed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = t(page ? "brain.forgetPage" : "brain.forgetAll");
  async function forget() {
    if (busy || signal.aborted) return;
    setBusy(true);
    try {
      await forgetBrainPages(owner, page, signal);
      changed();
    } catch {
      if (!signal.aborted) failed();
    } finally {
      setOpen(false);
      setBusy(false);
    }
  }
  return <>
    <button type="button" className="ui-button ui-button-sm" onClick={() => setOpen(true)}>{label}</button>
    <ConfirmDialog open={open} pending={busy} title={label} layer="z-[80]" confirmLabel={t("common.delete")}
      body={t(page ? "brain.forgetPageDetail" : "brain.forgetAllDetail")}
      onCancel={() => { if (!busy) setOpen(false); }} onConfirm={() => void forget()} />
  </>;
}
