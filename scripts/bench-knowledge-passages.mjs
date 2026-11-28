import { strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { cpuUsage, memoryUsage } from "node:process";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = "src/components/knowledge/source-index.ts";
const revision = process.argv[2];
const contents = revision
  ? execFileSync("git", ["show", `${revision}:${source}`], { cwd: root, encoding: "utf8" })
  : await readFile(join(root, source), "utf8");
const bundle = await build({
  stdin: { contents, sourcefile: source, loader: "ts", resolveDir: dirname(join(root, source)) },
  bundle: true, platform: "node", format: "esm", write: false, external: ["./pdf-text"],
});
const { indexSources, findPassages } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));

async function corpus(count, uniqueTerms) {
  const files = [];
  for (let start = 0; start < count; start += 200) {
    const path = `folder/report-${String(40000 - start).padStart(5, "0")}.txt`;
    const lines = Array.from({ length: Math.min(200, count - start) }, (_, n) => {
      const id = start + n;
      const extra = Array.from({ length: uniqueTerms }, (_, k) => String.fromCharCode(97 + k) + id).join(" ");
      return `Chứng từ ID${id}: ${id % 17 === 0 ? "đối chiếu công nợ" : "duyệt hồ sơ"} theo quy định ${id % 103 === 0 ? "invoice overdue" : "nghiệp vụ"}. Lô ${id % 89}. ${extra}`;
    });
    files.push({ path, file: new File([lines.join("\n\n")], path) });
  }
  const index = await indexSources(files, { docs: new Map(), changes: [] });
  strictEqual([...index.docs.values()].reduce((n, doc) => n + doc.passages.length, 0), count);
  return index;
}

function elapsed(index, query) {
  const cpu = cpuUsage();
  const time = performance.now();
  const hits = findPassages(index, query);
  const wallMs = performance.now() - time;
  const used = cpuUsage(cpu);
  return { wallMs, cpuMs: (used.user + used.system) / 1000, hits };
}

const round = ms => Number(ms.toFixed(3));
for (const [count, uniqueTerms] of [[0, 0], [100, 0], [1000, 0], [10000, 0], [40000, 0], [10000, 25]]) {
  if (global.gc) global.gc();
  const index = await corpus(count, uniqueTerms);
  const coldMs = round(elapsed(index, "chung tu").wallMs);
  const queries = [];
  for (const query of ["chung tu", "cong no invoice", "id350", "folder", "absent"]) {
    const warm = Array.from({ length: 22 }, () => elapsed(index, query)).slice(2);
    const wall = warm.map(row => row.wallMs).sort((a, b) => a - b);
    const cpu = warm.map(row => row.cpuMs).sort((a, b) => a - b);
    const citations = warm[0].hits.map(hit => [hit.path, hit.passage.start, hit.score]);
    queries.push({ query, p50Ms: round(wall[9]), p95Ms: round(wall[18]), p50CpuMs: round(cpu[9]),
      resultSha256: createHash("sha256").update(JSON.stringify(citations)).digest("hex") });
  }
  if (global.gc) global.gc();
  const { heapUsed, rss } = memoryUsage();
  console.log(JSON.stringify({ count, uniqueTerms, documents: index.docs.size, coldMs, queries, heapUsed, rss }));
}
