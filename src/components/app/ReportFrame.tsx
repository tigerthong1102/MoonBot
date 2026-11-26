import { useLayoutEffect, useRef, useState } from "react";
import { appVersion, openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { AppDocument } from "../../../shared/app";
import { ROOM_CAN } from "../../../shared/app-frame/document";
import { mountAppFrame } from "./app-frame-host";
import { appHostContext, appMaxHeight } from "./app-host-context";

export function ReportFrame({ doc }: { doc: AppDocument }) {
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState("");
  const pending = useRef<{ resolve(): void; reject(reason: Error): void } | null>(null);
  function cancelLink() {
    pending.current?.reject(new Error("Link request cancelled."));
    pending.current = null;
    setLink("");
  }
  const title = t("knowledge.report");
  useLayoutEffect(() => {
    const container = box.current;
    if (!container) return;
    // The parent’s frame-src continues to restrict navigation after a srcdoc document replaces itself.
    if (!document.head.querySelector("meta[data-report-frame-policy]")) {
      const policy = document.createElement("meta");
      policy.httpEquiv = "Content-Security-Policy";
      policy.content = "frame-src about:";
      policy.setAttribute("data-report-frame-policy", "");
      document.head.append(policy);
    }
    const refuse = async () => { throw new Error("This report is read-only."); };
    const frame = mountAppFrame({
      container, title, doc: { ...doc, can: { ...ROOM_CAN, openLinks: doc.can.openLinks === true } },
      height: appMaxHeight(), fill: true, disableForms: true, hostVersion: appVersion(),
      hostContext: appHostContext({ width: container.clientWidth, maxHeight: appMaxHeight() }),
      adapter: {
        callRpc: refuse, sendMessage: refuse, setContext: refuse, openLink: openExternalLink,
        confirmOpenLink(url) {
          if (pending.current || document.activeElement !== frame.iframe || !navigator.userActivation?.isActive) return refuse();
          return new Promise<void>((resolve, reject) => { pending.current = { resolve, reject }; setLink(url); });
        },
        resize() {}, teardownRequested() {},
      },
    });
    return () => { frame.destroy(); cancelLink(); };
  }, [doc, title]);
  return <><div ref={box} className="min-h-0 flex-1" />
    {link && <section role="group" aria-label={t("webPanels.page.openInBrowser")} className="flex flex-wrap items-center gap-2 border-t border-hairline bg-panel p-2">
      <bdi dir="ltr" className="min-w-0 flex-1 break-all text-sm">{link}</bdi>
      <a href={link} target="_blank" rel="noopener noreferrer" className="ui-button ui-button-sm" onClick={event => {
        event.preventDefault();
        const reply = pending.current;
        if (!reply) return;
        pending.current = null; setLink("");
        void openExternalLink(link).then(reply.resolve, reply.reject);
      }}>{t("webPanels.page.openInBrowser")}</a>
      <button type="button" className="ui-button ui-button-sm" onClick={cancelLink}>{t("common.cancel")}</button>
    </section>}</>;
}
