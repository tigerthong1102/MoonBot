import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateTranslationCatalog } from "./generate-locale.mjs";

const load = (path) => JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("every English desktop message has Vietnamese text and the same arguments", () => {
  const translations = load("src/locales/vi.json");
  assert.deepEqual(validateTranslationCatalog(load("src/locales/en.json"), translations, { requireComplete: true }), []);
  for (const [key, value] of Object.entries(translations)) assert.doesNotMatch(value, /<unk>|ZX[A-Z]QZ/, key);
});

test("Vietnamese iOS app and share catalogs preserve every localized format argument", () => {
  const formats = value => (value.match(/%(?:\d+\$)?(?:lld|ld|@|d|f|s)/g) ?? []).sort();
  for (const bundle of ["App", "ShareExtension"]) {
    for (const [english, entry] of Object.entries(load("ios/" + bundle + "/Localizable.xcstrings").strings)) {
      if (entry.shouldTranslate === false) continue;
      const vi = entry.localizations?.vi?.stringUnit;
      assert.equal(vi?.state, "translated", english);
      assert.ok(vi.value.trim(), english);
      assert.doesNotMatch(vi.value, /<unk>|ZX[A-Z]QZ/, english);
      assert.deepEqual(formats(vi.value), formats(english), english);
    }
  }
});
