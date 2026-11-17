import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { freePortBlock } from "./ports.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function occupy(host: string) {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
  return { server, port: (server.address() as AddressInfo).port };
}

describe("port probes for a fixture's actual listener", () => {
  it("refuses an occupied IPv6 port even when IPv4 can bind the same number", async () => {
    const { port } = await occupy("::1");
    const v4 = createServer();
    await new Promise<void>((resolve, reject) => { v4.once("error", reject); v4.listen(port, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => v4.close(() => resolve()));
    await expect(freePortBlock([0], port, 1, "::1")).rejects.toThrow("no free port block");
  });

  it("checks every IPv6 offset", async () => {
    const { port } = await occupy("::1");
    await expect(freePortBlock([0, 1], port - 1, 1, "::1")).rejects.toThrow("no free port block");
  });

  it("can use the IPv6 number after its listener closes", async () => {
    const { port, server } = await occupy("::1");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.splice(servers.indexOf(server), 1);
    expect(await freePortBlock([0], port, 1, "::1")).toBe(port);
  });

  it("still refuses occupied IPv4 ports by default", async () => {
    const { port } = await occupy("127.0.0.1");
    await expect(freePortBlock([0], port, 1)).rejects.toThrow("no free port block");
  });
});
