// A Windows Invoke reports delivery, not navigation. Only a destination the person explicitly names can prove it.
import type { SlimStructured } from "./driver-wire.ts";
import type { RequestJournal } from "./journal.ts";
import { exactRequest } from "./key.ts";
import type { Recipe, RecipeStep } from "./rules.ts";

export function windowsDestination(request: string): { button: string; title: string } | { button: string; tab: string } | undefined {
  const tabMatch = /^(?:Navigate using button "([^"\r\n]{1,160})" and verify tab "([^"\r\n]{1,160})"|Điều hướng bằng nút "([^"\r\n]{1,160})" và xác minh thẻ "([^"\r\n]{1,160})")$/u.exec(request.trim());
  if (tabMatch) {
    const button = tabMatch[1] ?? tabMatch[3]!;
    const tab = tabMatch[2] ?? tabMatch[4]!;
    if (exactRequest(request) !== request.trim() || button !== button.trim() || tab !== tab.trim() || /\p{Cc}/u.test(button + tab)) return undefined;
    return { button, tab };
  }
  const match = /^(?:Navigate using button "([^"\r\n]{1,160})" and verify window title "([^"\r\n]{1,160})"|Điều hướng bằng nút "([^"\r\n]{1,160})" và xác minh tiêu đề cửa sổ "([^"\r\n]{1,160})")$/u.exec(request.trim());
  if (!match || exactRequest(request) !== request.trim()) return undefined;
  const button = match[1] ?? match[3]!;
  const title = match[2] ?? match[4]!;
  if (button !== button.trim() || title !== title.trim() || /\p{Cc}/u.test(button + title)) return undefined;
  return { button, title };
}

export function expectedWindowsDestination(recipe: Pick<Recipe, "request" | "steps">): { title: string } | { tab: string } | undefined {
  const destination = windowsDestination(recipe.request);
  const step = recipe.steps[0];
  if (!destination || recipe.steps.length !== 1 || !(step?.element?.uiaWindowChild || step?.element?.linuxWindowChild) || step.element.label !== destination.button
    || !step.app?.name || !step.window?.title) return undefined;
  if (step.element.linuxWindowChild && "tab" in destination) return undefined;
  if ("tab" in destination) return { tab: destination.tab };
  return step.window.title === destination.title ? undefined : { title: destination.title };
}

export function windowsTabCount(data: SlimStructured | undefined, label: string): number {
  return data?.elements?.filter((row) => row.role === "TabItem" && row.label === label).length ?? 0;
}

export function windowsTabSelected(data: SlimStructured | undefined, label: string): boolean {
  const matches = data?.elements?.filter((row) => row.role === "TabItem" && row.label === label) ?? [];
  return matches.length === 1 && matches[0]!.selected === true;
}

export function windowsSnapshotMatches(
  data: SlimStructured | undefined, step: RecipeStep, pid: unknown, windowId: unknown, title: string,
): boolean {
  return Number.isSafeInteger(pid) && Number.isSafeInteger(windowId) && data?.elements_complete === true && data.tree_format === "elements" && !data.refusal
    && data.pid === pid && data.window_id === windowId && (step.element?.linuxWindowChild || data.app_name === step.app?.name) && data.window_title === title;
}

export function recordedWindowsDestination(recipe: Recipe, journal: RequestJournal): boolean {
  const destination = expectedWindowsDestination(recipe);
  if (!destination) return false;
  const step = recipe.steps[0]!;
  const index = journal.calls.findIndex((call) => call.tool === "click");
  const action = journal.calls[index];
  if (!action || action.result.structured?.background_accessibility_action !== true) return false;
  const { pid, window_id: windowId, element_token: token } = action.arguments;
  const matchingWindow = (call: RequestJournal["calls"][number]) => call.tool === "get_window_state"
    && call.arguments.pid === pid && call.arguments.window_id === windowId && call.arguments.tree_format === "elements"
    && call.arguments.include_screenshot !== true
    && (call.arguments.session === undefined || typeof call.arguments.session === "string")
    && Object.keys(call.arguments).every((key) => ["pid", "window_id", "tree_format", "include_screenshot", "timeout_ms", "max_elements", "session"].includes(key));
  const before = journal.calls.slice(0, index).findLast(matchingWindow);
  const after = journal.calls.slice(index + 1).find(matchingWindow);
  return windowsSnapshotMatches(before?.result.structured, step, pid, windowId, step.window!.title)
    && before?.result.structured?.elements?.some((row) => row.element_token === token && (step.element?.linuxWindowChild ? row.linux_window_child === true : row.uia_window_child === true)) === true
    && ("title" in destination
      ? windowsSnapshotMatches(after?.result.structured, step, pid, windowId, destination.title)
      : windowsTabCount(before?.result.structured, destination.tab) === 0
        && windowsSnapshotMatches(after?.result.structured, step, pid, windowId, step.window!.title)
        && windowsTabSelected(after?.result.structured, destination.tab));
}

