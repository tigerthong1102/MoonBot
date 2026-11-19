import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { choosePhonePort } from "./companion-port.mjs";

test("a busy listener stays intact and a previously paired port is preferred on restart", async () => {
  const occupy = async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  };
  const first = await occupy();
  const second = await occupy();
  const ports = [first.address().port, second.address().port];
  try {
    await assert.rejects(choosePhonePort(ports[0], ports), /No available/);
    await new Promise(done => second.close(done));
    assert.equal(await choosePhonePort(ports[0], ports), ports[1]);
    await new Promise(done => first.close(done));
    assert.equal(await choosePhonePort(ports[1], ports), ports[1]);
    assert.equal(await choosePhonePort(-1, ports), ports[0]);
  } finally {
    if (first.listening) first.close();
    if (second.listening) second.close();
  }
});
