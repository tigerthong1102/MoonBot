import { expect, it } from "vitest";
import type { Message } from "./store.ts";
import { captureWorkBotContext, scanWorkBotContext, unsupportedWorkBotContext } from "./work-bot-context.ts";

it("blocks handoff when source context or a replied-to row cannot be copied", async () => {
  const user = { id: "user", role: "user", kind: "text", text: "Track this", at: 1 } as Message;
  for (const extra of [
    { id: "widget", role: "bot", kind: "widget", text: "Revenue: 42", at: 0 },
    { id: "app", role: "bot", kind: "app", text: "Revenue: 42", at: 0 },
    { id: "compact", role: "bot", kind: "compaction", at: 0 },
    { id: "room", role: "bot", kind: "text", text: "Result", roomRequest: { phase: "result" }, at: 0 },
  ]) {
    expect(unsupportedWorkBotContext([extra as Message, user])).toBe("data");
  }
  const card = { id: "card", role: "bot", kind: "options", at: 0 } as Message;
  for (const provenance of [{ peerAsk: {} }, { relay: {} }, { relayed: true }, { via: "api" }, { apiAsOwner: true }, { aside: true }, { fromApp: {} }, { pointed: [{ appId: "fixture", label: "Synthetic item" }] }, { automation: {} }, { automated: true }, { steered: true }, { webhookPost: {} }, { peerPost: {} }, { serverCard: true }, { setupSuggestion: {} }, { settingsCard: {} }, { reaction: "👍" }]) {
    expect(unsupportedWorkBotContext([{ ...user, ...provenance } as Message])).toBe("data");
  }
  const digest = { ...user, kind: "digest", role: "bot", digest: { tools: [], memory: [], reply: "Done", hookCoverage: "none" } } as unknown as Message;
  expect(unsupportedWorkBotContext([digest, user])).toBeNull();
  for (const extra of [{ files: { changed: ["README"], added: [], deleted: [] } }, { files: { changed: [], added: [], deleted: [], truncated: 1 } }, { memory: [{ path: "private", kind: "updated" }] }, { memoryDropped: 1 }]) {
    expect(unsupportedWorkBotContext([{ ...digest, digest: { ...digest.digest!, ...extra } }, user] as Message[])).toBe("files");
  }
  const reply = { ...user, id: "reply", replyToId: "card" };
  expect(unsupportedWorkBotContext([card, reply, user])).toBe("data");
  const text = { ...user, id: "earlier" };
  const filler = Array.from({ length: 100 }, (_, i) => ({ ...user, id: `filler-${i}` }));
  expect(await scanWorkBotContext([text, ...filler, { ...user, replyToId: "earlier" }], new AbortController().signal)).toBeNull();
  expect(await scanWorkBotContext([card, ...filler, reply], new AbortController().signal)).toBe("data");
});

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
  for (const text of ["Read report.numbers", "Open budget.pages", "Inspect report.log"]) {
    expect(unsupportedWorkBotContext([row(text)])).toBe("files");
  }
  expect(unsupportedWorkBotContext([row("Track version 1.2 and price 3.50")])).toBeNull();
  for (const text of ["Theo dõi startupbot.vn mỗi ngày", "Theo dõi google.com mỗi ngày", "Theo dõi email john.smith@example.com", "Theo dõi khách hàng v.d. mỗi tuần", "Tóm tắt tin mới nhé.Chi tiết gửi sau"]) {
    expect(unsupportedWorkBotContext([row(text)])).toBeNull();
  }
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
