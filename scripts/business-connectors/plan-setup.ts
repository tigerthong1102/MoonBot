import { setupPlan } from "./setup-plan.ts";

async function run() {
  if (process.argv.length !== 3 || process.argv[2] !== "--dry-run") throw new Error();
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error();
    chunks.push(chunk);
  }
  const plan = setupPlan(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  process.stdout.write(JSON.stringify(plan) + "\n");
}
run().catch(() => { process.stderr.write('{"error":"invalid-dry-run-input"}\n'); process.exitCode = 1; });
