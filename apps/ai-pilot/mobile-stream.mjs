export async function consumeMobileStream(response, stream, rememberGeneration) {
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("stream_expected");
  let buffer = "", id, answer = "", finish, usage, done = false, bytes = 0;
  const reader = response.body.pipeThrough(new TextDecoderStream("utf-8", { fatal: true })).getReader();
  try {
    while (!done) {
      const part = await reader.read();
      if (part.done) throw new Error("incomplete_stream");
      bytes += Buffer.byteLength(part.value);
      if (bytes > 2 * 1024 * 1024) throw new Error("stream_too_large");
      buffer += part.value;
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          if (!id || !finish) throw new Error("missing_completion");
          done = true;
          break;
        }
        const event = JSON.parse(data);
        if (event.error || typeof event.id !== "string" || !event.id || event.id.length > 256 ||
            (id && event.id !== id)) throw new Error("invalid_generation");
        if (!id) {
          id = event.id;
          rememberGeneration(id);
        }
        const choice = event.choices?.[0];
        if (choice?.delta?.content) {
          if (finish || typeof choice.delta.content !== "string") throw new Error("invalid_delta");
          answer += choice.delta.content;
          if (Buffer.byteLength(answer) > 128 * 1024) throw new Error("response_too_large");
          await stream.delta(choice.delta.content);
        }
        if (choice?.finish_reason) {
          if (!["stop", "length"].includes(choice.finish_reason)) throw new Error("unsupported_finish");
          finish = choice.finish_reason;
        }
        if (event.usage) usage = event.usage;
      }
    }
    return { id, choices: [{ message: { role: "assistant", content: answer }, finish_reason: finish }], usage };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
