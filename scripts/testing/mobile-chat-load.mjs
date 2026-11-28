import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

const clients = 32, rounds = 4;
const fixture = await startMobileFixture();
try {
  const start = performance.now(), first = [], total = [];
  const accounts = await Promise.all(Array.from({ length:clients }, async (_, n) => {
    const account = "load-" + n;
    fixture.grant(account);
    return { account, thread:randomUUID(), cookie:await fixture.login(account) };
  }));
  for (let round = 0; round < rounds; round++) {
    await Promise.all(accounts.map(async ({ account, thread, cookie }) => {
      const begin = performance.now();
      const response = await fixture.call("/send", cookie, { account, thread, id:randomUUID(), prompt:"hello", save:true });
      if (!response.ok) throw new Error("Unexpected status " + response.status);
      const reader = response.body.getReader(), head = await reader.read();
      first.push(performance.now() - begin);
      let output = new TextDecoder().decode(head.value);
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
      }
      if (!output.includes('"state":"complete"')) throw new Error("Incomplete fixture turn");
      total.push(performance.now() - begin);
    }));
  }
  function percentile(values, fraction) {
    return Math.round(values.toSorted((a,b) => a-b)[Math.ceil(fraction * values.length)-1]);
  }
  console.log(JSON.stringify({ clients, completed:total.length, wallMs:Math.round(performance.now()-start),
    firstDeltaP50Ms:percentile(first,0.50), firstDeltaP95Ms:percentile(first,0.95), completeP95Ms:percentile(total,0.95),
    billedFixtureRequests:fixture.ledger.db.prepare("SELECT count(*) n FROM requests WHERE state='settled'").get().n }));
} finally { await fixture.close(); }
