export function botUsername(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return `bot_u${id.replaceAll("-", "")}`;
  let encoded = "";
  for (let i = 0; i < id.length; i += 1) encoded += id.charCodeAt(i).toString(16).padStart(4, "0");
  return `bot_x${encoded}`;
}
