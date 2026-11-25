export function botMoveMayRestoreWork(bot: { movedTo?: unknown } | null | undefined): boolean {
  const moved = bot?.movedTo;
  if (moved === undefined) return false;
  if (moved === null || typeof moved !== "object" || Array.isArray(moved)) return true;
  const value = moved as { state?: unknown; held?: unknown };
  if (value.state !== "moved" || !Array.isArray(value.held)) return true;
  return value.held.length > 0;
}
