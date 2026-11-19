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

test("inbox controls, invitation emails and codes follow every supported app language", () => {
  const tags = Object.keys(load("shared/app-language-names.json"));
  const mail = load("cloudflare/control-plane/src/inbox-mail-text.json");
  const reference = load("src/locales/en.json");
  const keys = Object.keys(reference).filter(key => key.startsWith("personalInbox."));
  const args = value => (value.match(/\{\w+\}/g) ?? []).sort();
  assert.deepEqual(Object.keys(mail).sort(), [...tags].sort());
  for (const file of ["index.html", "inbox.js", "group-controls.js", "group-bots.js"]) {
    const source = readFileSync(new URL("../cloudflare/control-plane/inbox/public/" + file, import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/"(personalInbox\.\w+)"/g)) assert.ok(reference[key], file + ": " + key);
  }
  for (const tag of tags) {
    const catalog = load("src/locales/" + tag + ".json");
    for (const key of keys) {
      assert.ok(catalog[key]?.trim(), tag + ": " + key);
      if (!["zh","zh-tw","ja"].includes(tag)) assert.doesNotMatch(catalog[key], /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]/u, tag + ": " + key);
      assert.deepEqual(args(catalog[key]), args(reference[key]), tag + ": " + key);
    }
    for (const key of Object.keys(mail.en)) assert.equal(mail[tag][key], catalog["personalInbox." + key]);
  }
});
