import { useId, useState, type ReactNode } from "react";

export function WorkflowDisclosure({ title, onOpen, children }: { title: string; onOpen?(): void; children: ReactNode }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return <div className="min-w-0 text-sm">
    <button type="button" className="ui-button ui-button-sm" aria-expanded={open} aria-controls={panelId}
      onClick={() => { setOpen(!open); if (!open) onOpen?.(); }}>{title}</button>
    <div id={panelId} hidden={!open}>{children}</div>
  </div>;
}
