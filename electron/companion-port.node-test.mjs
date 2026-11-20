import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { listenOnPhonePort } from "../companion/src/phone-port.ts";

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
  const listener = createServer();
  const bind = port => new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, "0.0.0.0", resolve);
  });
  const close = () => new Promise(done => listener.close(done));
  try {
    await assert.rejects(listenOnPhonePort(ports, bind), /No available/);
    await new Promise(done => second.close(done));
    assert.equal(await listenOnPhonePort(ports, bind), ports[1]);
    await close();
    await new Promise(done => first.close(done));
    assert.equal(await listenOnPhonePort([ports[1], ports[0]], bind), ports[1]);
    await close();
    assert.equal(await listenOnPhonePort(ports, bind), ports[0]);
  } finally {
    if (listener.listening) await close();
    if (first.listening) first.close();
    if (second.listening) second.close();
  }
});
