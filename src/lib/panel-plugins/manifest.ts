import { z } from "zod";
import { isSafePluginId } from "./plugin-id-format";

export const MAX_MANIFEST_BYTES = 65_536;
const id = z.string().refine(isSafePluginId);
const label = z.string().trim().min(1).max(128);
const panel = z.strictObject({
  id, title: label, ui: z.literal("static"),
  rows: z.array(z.strictObject({ label, value: z.string().max(2048) })).min(1).max(80),
});
const schema = z.strictObject({
  manifestVersion: z.literal(2), pluginApi: z.literal(1), execution: z.literal("sandboxed-ui"),
  id, name: label, version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/),
  description: z.string().max(256).optional(),
  capabilities: z.tuple([]),
  contributes: z.strictObject({
    panels: z.array(panel).min(1).max(8).refine((panels) => new Set(panels.map((item) => item.id)).size === panels.length),
  }),
});
export type PanelManifest = z.infer<typeof schema>;

export function readPanelManifest(text: string): PanelManifest {
  if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
  return schema.parse(JSON.parse(text));
}
