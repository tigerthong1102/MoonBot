import { exactRequest } from "./key.ts";
import type { RequestJournal } from "./journal.ts";
import type { Recipe } from "./rules.ts";
import { windowsDestination, windowsSnapshotMatches } from "./windows-destination.ts";

type Navigation = { button: string; title: string };

export function linuxDestinations(request: string): Navigation[] | undefined {
  if (request !== exactRequest(request)) return undefined;
  const single = windowsDestination(request);
  if (single && "title" in single) return [single];
  const first = /^(?:Navigate using button "([^"\r\n]{1,160})" and verify window title "([^"\r\n]{1,160})"|Điều hướng bằng nút "([^"\r\n]{1,160})" và xác minh tiêu đề cửa sổ "([^"\r\n]{1,160})")/u.exec(request);
  if (!first) return undefined;
  const vietnamese = first[3] !== undefined;
  const result: Navigation[] = [{ button: first[1] ?? first[3]!, title: first[2] ?? first[4]! }];
  let remaining = request.slice(first[0].length);
  const next = vietnamese
    ? /^, sau đó nút "([^"\r\n]{1,160})" và xác minh tiêu đề cửa sổ "([^"\r\n]{1,160})"/u
    : /^, then button "([^"\r\n]{1,160})" and verify window title "([^"\r\n]{1,160})"/u;
  while (remaining) {
    const match = next.exec(remaining);
    if (!match || result.length >= 40) return undefined;
    result.push({ button: match[1]!, title: match[2]! });
    remaining = remaining.slice(match[0].length);
  }
  if (result.length < 2 || result.some(({ button, title }) => button !== button.trim() || title !== title.trim() || /\p{Cc}/u.test(button + title))) return undefined;
  return result;
}

export function expectedLinuxDestinations(recipe: Pick<Recipe, "request" | "steps">): Navigation[] | undefined {
  const destinations = linuxDestinations(recipe.request);
  if (!destinations || destinations.length !== recipe.steps.length) return undefined;
  const first = recipe.steps[0];
  if (!first?.app?.name || !first.window?.title) return undefined;
  for (const [index, step] of recipe.steps.entries()) {
    const destination = destinations[index]!;
    if (!step.element?.linuxWindowChild || step.element.label !== destination.button || step.app?.name !== first.app.name
      || step.app.bundleId !== first.app.bundleId || !step.window?.title || step.window.title === destination.title
      || (index > 0 && step.window.title !== destinations[index - 1]!.title)) return undefined;
  }
  return destinations;
}

export function recordedLinuxDestinations(recipe: Recipe, journal: RequestJournal): boolean {
  const destinations = expectedLinuxDestinations(recipe);
  if (!destinations) return false;
  const actions = journal.calls.flatMap((call, index) => call.tool === "click" ? [index] : []);
  if (actions.length !== recipe.steps.length) return false;
  let firstPid: unknown, firstWindow: unknown;
  return actions.every((index, stepIndex) => {
    const step = recipe.steps[stepIndex]!;
    const action = journal.calls[index]!;
    if (action.result.structured?.background_accessibility_action !== true) return false;
    const { pid, window_id: windowId, element_token: token } = action.arguments;
    if (stepIndex === 0) { firstPid = pid; firstWindow = windowId; }
    if (pid !== firstPid || windowId !== firstWindow) return false;
    const matchingWindow = (call: RequestJournal["calls"][number]) => call.tool === "get_window_state"
      && call.arguments.pid === pid && call.arguments.window_id === windowId && call.arguments.tree_format === "elements"
      && call.arguments.include_screenshot !== true && (call.arguments.session === undefined || typeof call.arguments.session === "string")
      && Object.keys(call.arguments).every((key) => ["pid", "window_id", "tree_format", "include_screenshot", "timeout_ms", "max_elements", "session"].includes(key));
    const previousAction = actions[stepIndex - 1] ?? -1;
    const nextAction = actions[stepIndex + 1] ?? journal.calls.length;
    const before = journal.calls.slice(previousAction + 1, index).findLast(matchingWindow);
    const after = journal.calls.slice(index + 1, nextAction).find(matchingWindow);
    return windowsSnapshotMatches(before?.result.structured, step, pid, windowId, step.window!.title)
      && before?.result.structured?.elements?.some((row) => row.element_token === token && row.linux_window_child === true) === true
      && windowsSnapshotMatches(after?.result.structured, step, pid, windowId, destinations[stepIndex]!.title);
  });
}

