// A Windows Invoke reports delivery, not navigation. Only a destination the person explicitly names can prove it.
import type { SlimStructured } from "./driver-wire.ts";
import type { RequestJournal } from "./journal.ts";
import { exactRequest } from "./key.ts";
import type { Recipe, RecipeStep } from "./rules.ts";

export function windowsDestination(request: string): { button: string; title: string } | undefined {
  const match = /^(?:Navigate using button "([^"\r\n]{1,160})" and verify window title "([^"\r\n]{1,160})"|Điều hướng bằng nút "([^"\r\n]{1,160})" và xác minh tiêu đề cửa sổ "([^"\r\n]{1,160})")$/u.exec(request.trim());
  if (!match || exactRequest(request) !== request.trim()) return undefined;
  const button = match[1] ?? match[3]!;
  const title = match[2] ?? match[4]!;
  if (button !== button.trim() || title !== title.trim() || /\p{Cc}/u.test(button + title)) return undefined;
  return { button, title };
}

export function expectedWindowsTitle(recipe: Pick<Recipe, "request" | "steps">): string | undefined {
  const destination = windowsDestination(recipe.request);
  const step = recipe.steps[0];
  if (!destination || recipe.steps.length !== 1 || !step?.element?.uiaWindowChild || step.element.label !== destination.button
    || !step.app?.name || !step.window?.title || step.window.title === destination.title) return undefined;
  return destination.title;
}

export function windowsSnapshotMatches(
  data: SlimStructured | undefined, step: RecipeStep, pid: unknown, windowId: unknown, title: string,
): boolean {
  return Number.isSafeInteger(pid) && Number.isSafeInteger(windowId) && data?.elements_complete === true && data.tree_format === "elements" && !data.refusal
    && data.pid === pid && data.window_id === windowId && data.app_name === step.app?.name && data.window_title === title;
}

export function recordedWindowsDestination(recipe: Recipe, journal: RequestJournal): boolean {
  const title = expectedWindowsTitle(recipe);
  if (!title) return false;
  const step = recipe.steps[0]!;
  const index = journal.calls.findIndex((call) => call.tool === "click");
  const action = journal.calls[index];
  if (!action || action.result.structured?.background_accessibility_action !== true) return false;
  const { pid, window_id: windowId, element_token: token } = action.arguments;
  const matchingWindow = (call: RequestJournal["calls"][number]) => call.tool === "get_window_state"
    && call.arguments.pid === pid && call.arguments.window_id === windowId && call.arguments.tree_format === "elements"
    && call.arguments.include_screenshot !== true;
  const before = journal.calls.slice(0, index).findLast(matchingWindow);
  const after = journal.calls.slice(index + 1).find(matchingWindow);
  return windowsSnapshotMatches(before?.result.structured, step, pid, windowId, step.window!.title)
    && before?.result.structured?.elements?.some((row) => row.element_token === token && row.uia_window_child === true) === true
    && windowsSnapshotMatches(after?.result.structured, step, pid, windowId, title);
}
