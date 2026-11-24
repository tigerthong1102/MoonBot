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
  expect(unsupportedWorkBotContext([row("Theo dõi data/hoadon.xlsx mỗi tuần")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Review báo-cáo.csv")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read .\\reports\\stock.pdf")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Check reports/report.md and data/ledger.sqlite")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Open data/query.sql")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Theo dõi ảnh.heic")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read ./folder/report")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Theo dõi ảnh.avif và hình.gif")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read âm-thanh.wav")])).toBe("files");
  expect(unsupportedWorkBotContext([row("Read [website](https://example.test/news)")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Read https://example.test/report.pdf")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Read https://example.test/?file=report.pdf")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Theo dõi https://example.test/?name=báo-cáo.csv")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Read https://x.test/?next=/reports/a&p=C:/x")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Giúp anh/chị theo dõi bán hàng và/hoặc marketing")])).toBeNull();
  expect(unsupportedWorkBotContext([row("Giúp anh/chị theo dõi bán hàng và/hoặc marketing".normalize("NFD"))])).toBeNull();
  expect(unsupportedWorkBotContext([row("Track sales/marketing weekly")])).toBeNull();
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
