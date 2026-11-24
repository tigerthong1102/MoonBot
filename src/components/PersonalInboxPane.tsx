import { useLayoutEffect, useRef, useState } from "react";

export function usePersonalInboxPane(workspaceSelection: string) {
  const [shown, setShown] = useState(false);
  const selection = useRef(workspaceSelection);
  useLayoutEffect(() => window.ogb?.personalInbox?.onVisibility(setShown), []);
  useLayoutEffect(() => {
    const changed = selection.current !== workspaceSelection;
    selection.current = workspaceSelection;
    if (changed && shown) void window.ogb?.personalInbox?.close().catch(() => {});
  }, [shown, workspaceSelection]);
  return shown;
}

export function PersonalInboxPane({ overlay }: { overlay: boolean }) {
  const slot = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bridge = window.ogb?.personalInbox;
    const element = slot.current;
    if (!bridge || !element) return;
    let frame = 0;
    let previous = "";
    const render = () => {
      const modal = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length > 0 && !dialog.closest("[hidden], [inert]"));
      const { x, y, width, height } = element.getBoundingClientRect();
      const bounds = overlay || modal || !width || !height ? null : { x, y, width, height };
      const key = JSON.stringify(bounds);
      if (key === previous) return;
      previous = key;
      void bridge.bounds(bounds).catch(() => {});
    };
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    };
    const layout = new ResizeObserver(queue);
    layout.observe(element);
    window.addEventListener("resize", queue);
    const dialogs = new MutationObserver(queue);
    dialogs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-modal"] });
    render();
    return () => {
      layout.disconnect();
      dialogs.disconnect();
      window.removeEventListener("resize", queue);
      cancelAnimationFrame(frame);
    };
  }, [overlay]);
  return <main ref={slot} className="relative min-h-0 min-w-0 flex-1 bg-app" data-personal-inbox-pane="" />;
}
