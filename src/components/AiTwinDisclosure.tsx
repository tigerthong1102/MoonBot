import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function AiTwinDisclosure({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
        className="inline-flex cursor-pointer items-center gap-1.5 text-start text-[13px] font-medium text-ink">
        <ChevronRight size={14} aria-hidden="true" className={open ? "rotate-90" : "rtl:-scale-x-100"} />
        {title}
      </button>
      <div id={id} hidden={!open}>{children}</div>
    </div>
  );
}
