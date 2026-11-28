import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createServer } from "node:https";
import { createServer as createHttp } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { basename, dirname, join, extname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  require = createRequire(join(root, "package.json")),
  cf = createRequire(join(root, "cloudflare/control-plane/package.json"));
const { Miniflare, convertV4MiniflareOptions } = createRequire(cf.resolve("wrangler/package.json"))("miniflare");
const { build } = require("esbuild"),
  { unstable_splitSqlQuery } = cf("wrangler");
const { launchVerificationServer } = await import(join(root, "scripts/control-omb.ts"));
const scratch = mkdtempSync(join(tmpdir(), "sb-pair-ux-")),
  ownerToken = randomBytes(32).toString("base64url");
const exact = process.argv.includes("--exact");
const all = (path) => readFileSync(path, "utf8");
const executable = process.env.PAIR_FIXTURE_ELECTRON ?? require("electron");
assert.match(basename(executable), /^electron(?:\.exe)?$/i, "Expected an Electron runtime");
assert.ok(existsSync(executable), "Install Electron or set PAIR_FIXTURE_ELECTRON");
let fixture, mf, server, desktopServer, electron;
try {
  const keyPath = join(scratch, "key.pem"),
    certPath = join(scratch, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const { outputFiles } = await build({
    stdin: {
      contents: `import worker from "./cloudflare/control-plane/src/personal-inbox-worker.ts";
 export default {fetch(req,env,ctx){return worker.fetch(req,{...env,EMAIL:{send:msg=>env.MAILBOX.fetch("https://fixture.test/",{method:"POST",body:JSON.stringify(msg)})}},ctx)}}`,
      resolveDir: root,
    },
    platform: "node",
    bundle: true,
    format: "esm",
    write: false,
    external: ["cloudflare:*", "node:*"],
  });
  const mails = [];
  server = createServer({ key: all(keyPath), cert: all(certPath) }, async (req, res) => {
    try {
      const path = new URL(req.url, "https://127.0.0.1").pathname;
      if (path.startsWith("/api/")) {
        const parts = [];
        for await (const chunk of req) parts.push(chunk);
        const reply = await mf.dispatchFetch(origin + req.url, {
          method: req.method,
          headers: req.headers,
          ...(parts.length ? { body: Buffer.concat(parts) } : {}),
        });
        res.writeHead(reply.status, Object.fromEntries(reply.headers));
        res.end(Buffer.from(await reply.arrayBuffer()));
        return;
      }
      const file = join(
        root,
        "cloudflare/control-plane/inbox/public",
        path === "/" ? "index.html" : path.slice(1),
      );
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader(
        "content-type",
        { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml" }[
          extname(file).slice(1)
        ] || "application/octet-stream",
      );
      res.end(readFileSync(file));
    } catch (e) {
      console.error(e);
      res.writeHead(500).end();
    }
  });
  const builtUI = (
    await build({
      stdin: {
        resolveDir: root,
        loader: "tsx",
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AiTwinPairing} from './src/components/AiTwinPairing';createRoot(document.getElementById('root')).render(<AiTwinPairing/>);`,
      },
      bundle: true,
      jsx: "automatic",
      tsconfig: join(root, "tsconfig.json"),
      format: "iife",
      define: { "process.env.NODE_ENV": '"production"' },
      write: false,
    })
  ).outputFiles[0].text;
  desktopServer = createHttp((req, res) => {
    res.setHeader("content-type", req.url.endsWith(".js") ? "text/javascript" : "text/html");
    res.end(
      req.url.endsWith(".js")
        ? builtUI
        : "<meta charset=utf-8><div id=root></div><script src=/desktop.js></script>",
    );
  });
  await new Promise((r) => desktopServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "https://127.0.0.1:" + server.address().port;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: "2026-08-25",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        INBOX_PILOT_EMAILS: "owner@example.test,peer@example.test",
        ...(exact && { INBOX_EXACT_ANSWER: "1" }),
        EMAIL_FROM: "service@example.test",
      },
      serviceBindings: {
        MAILBOX: async (request) => {
          mails.push(await request.json());
          return new Response("ok");
        },
      },
      outboundService: () => new Response(null, { status: 503 }),
    }),
  );
  const db = await mf.getD1Database("DB");
  const migrationDir = join(root, "cloudflare/control-plane/inbox/migrations");
  for (const name of readdirSync(migrationDir).sort()) {
    const statements = unstable_splitSqlQuery(all(join(migrationDir, name))).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
  async function call(path, cookie, body) {
    return mf.dispatchFetch(origin + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    });
  }
  async function login(addr = "owner@example.test") {
    const start = mails.length;
    assert.equal(
      (await call("auth/email-otp/send-verification-otp", "", { email: addr, type: "sign-in" })).status,
      200,
    );
    for (let i = 0; i < 100 && !mails[start]; i++) await wait(30);
    const otp = mails[start].text.match(/\b\d{8}\b/)[0],
      reply = await call("auth/sign-in/email-otp", "", { email: addr, otp });
    assert.equal(reply.status, 200);
    const cookie = reply.headers
      .getSetCookie()
      .find((c) => c.includes("session_token"))
      .split(";")[0];
    const split = cookie.indexOf("=");
    return { name: cookie.slice(0, split), value: cookie.slice(split + 1) };
  }
  const cookies = [await login(), await login(), await login()];
  const room = randomUUID(),
    question = "When is lunch?",
    answer = "At noon.";
  if (exact) {
    cookies.push(await login("peer@example.test"));
    const cookie = cookies[0].name + "=" + cookies[0].value;
    assert.equal(
      (await call("rooms", cookie, { id: room, kind: "direct", email: "peer@example.test", instant: true }))
        .status,
      200,
    );
  }
  fixture = await launchVerificationServer({
    OMB_TEST_DESKTOP_OWNER_TOKEN: ownerToken,
    OMB_DEV_TRUST_LOCAL_BROWSER: "0",
  });
  async function twin(method = "GET", body, suffix = "") {
    return fetch(fixture.info.url + "/api/ai-twin" + suffix, {
      method,
      headers: { "x-openmausbot-desktop-owner": ownerToken, "content-type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    });
  }
  const current = await (await twin()).json();
  const created = await twin("POST", {
    creationEpoch: current.creationEpoch,
    creationId: randomUUID(),
    createConsent: true,
    name: "Fixture twin",
  });
  assert.equal(created.status, 201);
  if (exact) {
    const { twin: profile } = await created.json();
    assert.equal(
      (
        await twin(
          "POST",
          { id: profile.id, revision: profile.revision, saveAsLesson: true, question, answer },
          "/lessons",
        )
      ).status,
      200,
    );
    const active = await (await twin()).json();
    const privateLesson = await twin(
      "POST",
      {
        id: active.twin.id,
        revision: active.twin.revision,
        saveAsLesson: true,
        question: "Private credential fixture",
        answer: "sk-proj-" + "a".repeat(32),
      },
      "/lessons",
    );
    assert.equal(privateLesson.status, 200);
    const filtered = await (await twin("GET", undefined, "/inbox-exact-lessons")).json();
    assert.deepEqual(
      filtered.lessons.map((l) => l.question),
      [question],
    );
    assert.equal((await fetch(fixture.info.url + "/api/ai-twin/inbox-exact-lessons")).status, 404);
  }
  const winPath = join(root, "scripts/testing/twin-inbox-pairing-ui.cjs");
  const spki = createHash("sha256")
    .update(new X509Certificate(all(certPath)).publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const file = join(scratch, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      root,
      origin,
      cookies,
      ownerToken,
      exact,
      room,
      question,
      answer,
      local: fixture.info.url,
      desktopOrigin: "http://127.0.0.1:" + desktopServer.address().port,
      scratch,
    }),
    { mode: 0o600 },
  );
  electron = spawn(
    executable,
    [
      "--ignore-certificate-errors-spki-list=" + spki,
      "--use-mock-keychain",
      "--password-store=basic",
      "--disable-background-networking",
      "--disable-component-update",
      "--user-data-dir=" + join(scratch, "electron-profile"),
      winPath,
      file,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: scratch,
        USERPROFILE: scratch,
        TMPDIR: scratch,
        TEMP: scratch,
        TMP: scratch,
        ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }),
        ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
        ...(process.env.XAUTHORITY && { XAUTHORITY: process.env.XAUTHORITY }),
      },
      stdio: "inherit",
    },
  );
  const timer = setTimeout(() => electron.kill(), 60_000);
  try {
    const code = await new Promise((resolve, reject) => {
      electron.once("exit", resolve);
      electron.once("error", reject);
    });
    assert.equal(code, 0);
  } finally {
    clearTimeout(timer);
  }
  console.log(
    "PASS: three fixture windows, separate OTP sessions, isolated workspace, Worker and D1. Native dialog arguments checked with a scripted response.",
  );
} finally {
  electron?.kill();
  desktopServer?.closeAllConnections();
  desktopServer?.close();
  await fixture?.close();
  server?.closeAllConnections();
  server?.close();
  await mf?.dispose();
  rmSync(scratch, { recursive: true, force: true });
}
