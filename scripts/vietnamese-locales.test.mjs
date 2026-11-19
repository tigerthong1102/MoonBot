import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { validateTranslationCatalog } from "./generate-locale.mjs";

const load = (path) => JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("every English desktop message has Vietnamese text and the same arguments", () => {
  const translations = load("src/locales/vi.json");
  assert.deepEqual(validateTranslationCatalog(load("src/locales/en.json"), translations, { requireComplete: true }), []);
  for (const [key, value] of Object.entries(translations)) assert.doesNotMatch(value, /<unk>|ZX[A-Z]QZ/, key);
});

test("Vietnamese iOS app and share catalogs preserve every localized format argument", () => {
  const formats = (value) => (value.match(/%(?:\d+\$)?(?:lld|ld|@|d|f|s)/g) ?? []).sort();
  for (const bundle of ["App", "ShareExtension"]) {
    const catalog = load("ios/" + bundle + "/Localizable.xcstrings").strings;
    for (const [english, entry] of Object.entries(catalog)) {
      if (entry.shouldTranslate === false) continue;
      const vi = entry.localizations?.vi?.stringUnit;
      assert.ok(vi, english);
      assert.equal(vi.state, "translated", english);
      assert.ok(vi.value.trim(), english);
      assert.doesNotMatch(vi.value, /<unk>|ZX[A-Z]QZ/, english);
      assert.deepEqual(formats(vi.value), formats(english), english);
    }
  }
});

test("Vietnamese setup instructions preserve commands, endpoint paths and configuration identifiers", () => {
  const english = load("src/locales/en.json");
  const vietnamese = load("src/locales/vi.json");
  const literal = /(?<![\w:/.])\/(?:[A-Za-z][A-Za-z0-9_-]*)(?:\/[A-Za-z0-9_-]+)*|\b(?:acknowledgePeerScope|decider\.workersAiAccountId|NAME=value)\b/g;
  for (const [key, source] of Object.entries(english)) {
    for (const match of source.match(literal) ?? []) {
      if (match === "/month") continue;
      assert.ok(vietnamese[key].includes(match), key + " must preserve " + match);
    }
  }
});

test("inbox controls and accessible labels use keys available in both pilot languages", () => {
  const catalogs = ["en", "vi"].map((tag) => load("src/locales/" + tag + ".json"));
  for (const file of ["index.html", "inbox.js", "group-controls.js"]) {
    const source = readFileSync(new URL("../cloudflare/control-plane/inbox/public/" + file, import.meta.url), "utf8");
    const keys = [...source.matchAll(/"((?:personalInbox)\.\w+)"/g)].map((match) => match[1]);
    assert.ok(keys.length, file);
    for (const key of keys) {
      for (const catalog of catalogs) assert.ok(catalog[key]?.trim(), file + ": " + key);
    }
  }
});
