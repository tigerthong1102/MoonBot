import { treeCounts, type TreeCounts } from "./driver-wire.ts";
import { heldValue, matchElement, type ComputerCaller } from "./resolve.ts";
import type { RecipeStep } from "./rules.ts";

export const DISPATCHED = "Action sent. Its effect was not observed.";
export const VALUE_UNVERIFIED = "The input was sent, but its value could not be verified. Check the app before trying again.";

export async function observeEffect(step: RecipeStep, args: Record<string, unknown>, before: TreeCounts | undefined,
  caller: ComputerCaller, signal: AbortSignal): Promise<{ output: string; uncertain?: true }> {
  const field = step.tool === "set_value" && step.element && typeof step.args.value === "string";
  const unknown = field ? { output: VALUE_UNVERIFIED, uncertain: true as const } : { output: DISPATCHED };
  if (!before || !Number.isSafeInteger(args.pid) || !Number.isSafeInteger(args.window_id)) return unknown;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
  const state = await caller.call("get_window_state", { pid: args.pid, window_id: args.window_id,
    include_screenshot: false, tree_format: "elements", timeout_ms: 2500 }, bounded).catch(() => null);
  if (bounded.aborted || !state?.ok) return unknown;
  const tree = state.structured;
  if (tree.pid !== args.pid || tree.window_id !== args.window_id || tree.window_title !== step.window?.title) return unknown;
  const after = treeCounts(tree);
  if (!after) return unknown;
  if (field && step.element) {
    const found = matchElement(tree.elements, step.element);
    return found.ok && heldValue(tree.elements, found.value.element_index) === step.args.value
      ? { output: "Verified the field value in the same window." } : unknown;
  }
  let added = 0, removed = 0;
  for (const [key, count] of after) added += Math.max(0, count - (before.get(key) ?? 0));
  for (const [key, count] of before) removed += Math.max(0, count - (after.get(key) ?? 0));
  if (added || removed) return { output: `Action sent. Accessibility tree changed (+${added}, −${removed}).` };
  return unknown;
}
