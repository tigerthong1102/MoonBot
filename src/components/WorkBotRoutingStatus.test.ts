import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));
const { WorkBotRoutingStatus } = await import("./WorkBotRoutingStatus");

it("tells the person to restart when cleanup could not safely finish", () => {
  const message = { id: "fixture", role: "user", kind: "text", text: "fixture", workBotRouting: { state: "dispatching", recoveryBlocked: true } } as Message;
  const html = renderToStaticMarkup(createElement(WorkBotRoutingStatus, { message, botId: "bot", threadId: "thread", dispatch: vi.fn() }));
  expect(html).toContain("server.workBot.restartToRecover");
  expect(html).not.toContain("chat.stop");
});

it("shows a red review warning for staged work", () => {
  const message = { id: "fixture", role: "user", kind: "text", text: "fixture", workBotReviewHold: true } as Message;
  const html = renderToStaticMarkup(createElement(WorkBotRoutingStatus, { message, botId: "bot", threadId: "thread", dispatch: vi.fn() }));
  expect(html).toContain("text-danger");
  expect(html).toContain("workBotRouting.held_for_review");
  const copied = { ...message, workBotCopy: { sourceThreadId: "source", sourceMessageId: "old", requestMessageId: "request" } };
  expect(renderToStaticMarkup(createElement(WorkBotRoutingStatus, { message: copied, botId: "bot", threadId: "thread", dispatch: vi.fn() }))).toBe("");
});
