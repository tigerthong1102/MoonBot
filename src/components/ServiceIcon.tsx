import { useState } from "react";
import { cn } from "@/lib/cn";

/** One connectable app as the Apps catalog lists it. */
export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

/** Render bundled icons or initials without disclosing the app catalog to an image service. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = card.logo;
  if (logo && logo !== failed && /^\/assets\/[\w.-]+\.(?:svg|png|webp)$/i.test(logo)) {
    return <img src={logo} alt="" loading="lazy" className={cn("rounded-xl object-contain", className)} onError={() => setFailed(logo)} />;
  }
  return (
    <span aria-hidden="true" className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </span>
  );
}
