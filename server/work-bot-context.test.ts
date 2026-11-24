import { expect, it } from "vitest";
import type { Message } from "./store.ts";
import { captureWorkBotContext, scanWorkBotContext, unsupportedWorkBotContext } from "./work-bot-context.ts";

const row = (text: string, extra: Partial<Message> = {}): Message => ({ id: "fixture", role: "user", kind: "text", text, at: 1, ...extra });

it("keeps untransferred Data and files in the original conversation", () => {
  expect(unsupportedWorkBotContext([row("work", { dataContext: { cardId: "c_42", draftSql: "SELECT 42" } })])).toBe("data");
  expect(unsupportedWorkBotContext([row('<attached-file path="/tmp/Tệp thử.txt" name="Tệp thử.txt"/>')])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read [report](file:///tmp/report.pdf)")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read /Users/test/Tệp-báo-cáo.pdf")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read `C:\\fixture\\Báo cáo.xlsx`")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read file:///tmp/report.pdf")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read (/Users/demo/report.pdf)")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read:C:\\fixture\\report.xlsx")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read [website](https://example.test/news)")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Track our inventory weekly")])).toBeNull();
});

it("refuses to commit if a file or Data context is added during a yield", async () => {
  for (const field of ["file", "data"] as const) {
    const messages = Array.from({ length: 150 }, (_, index) => row(`message ${index}`));
    const validate = captureWorkBotContext(messages, () => messages, messages.length - 1);
    await new Promise<void>(resolve => setImmediate(() => {
      messages[20] = field === "data" ? { ...messages[20]!, dataContext: { cardId: "c_3" } } : { ...messages[20]!, text: "Read /tmp/fixture.txt" };
      resolve();
    }));
    let commits = 0;
    expect(() => { validate(); commits += 1; }).toThrow("context changed");
    expect(commits).toBe(0);
  }
});

it("rechecks changed messages and yields while scanning a long history", async () => {
  const message = row("ordinary text");
  expect(unsupportedWorkBotContext([message])).toBeNull();
  message.text = "Read /tmp/fixture.txt";
  expect(unsupportedWorkBotContext([message])).toBe("files");
  message.text = "ordinary text";
  message.dataContext = { cardId: "c_2" };
  expect(unsupportedWorkBotContext([message])).toBe("data");
  const messages = Array.from({ length: 501 }, (_, index) => row(`message ${index}`));
  let yielded = false;
  setImmediate(() => { yielded = true; });
  expect(await scanWorkBotContext(messages, new AbortController().signal)).toBeNull();
  expect(yielded).toBe(true);
});
