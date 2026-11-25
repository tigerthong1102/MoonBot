const isControlCode = (code) => (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);

export function terminalText(value) {
  let shown = "";
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    shown += isControlCode(code) ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
  }
  return shown;
}

export function terminalLines(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => terminalText(line))
    .join("\n");
}
