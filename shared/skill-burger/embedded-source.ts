const INLINE_SOURCE = /(?:^|[\s;&|])(?:eval|(?:[^\s;&|]*\/)?(?:awk|gawk|sed))\s+("(?:\\.|[^"\\])*"|'[^']*')|(?:^|\s)(?:-[a-zA-Z]*[cerp]|--(?:eval|execute|expression|print))(?:\s+|=)?("(?:\\.|[^"\\])*"|'[^']*')/g;

export function embeddedSourceHas(command: string, contains: (source: string) => boolean): boolean {
  return [...command.matchAll(INLINE_SOURCE)].some((match) => contains(match[1] ?? match[2] ?? ""));
}
