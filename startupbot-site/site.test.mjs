import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./site.js', import.meta.url), 'utf8');
function page(path, language = 'vi', agent = '') {
  const elements = { '#language': { addEventListener: (_event, callback) => { elements.toggle = callback; } }, '#content': {} };
  const store = new Map([['startupbot-language', language]]);
  const document = { documentElement: {}, querySelector: key => elements[key], querySelectorAll: () => [] };
  runInNewContext(source, { document, location: { pathname: path }, navigator: { userAgent: agent }, localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) } });
  return { document, elements };
}

test('all pages render in Vietnamese and English', () => {
  for (const route of ['/', '/download', '/docs', '/support', '/releases', '/privacy', '/terms']) {
    const { document, elements } = page(route);
    assert.ok(elements['#content'].innerHTML.length > 100, route);
    assert.equal(document.documentElement.lang, 'vi');
    elements.toggle();
    assert.equal(document.documentElement.lang, 'en');
    assert.ok(elements['#content'].innerHTML.length > 100, route);
  }
});

test('download page suggests a platform without linking unavailable artifacts', () => {
  for (const [agent, platform] of [['iPhone', 'iPhone / iPad'], ['Android', 'Android'], ['Windows NT', 'Windows'], ['Macintosh', 'macOS']]) {
    const html = page('/download', 'en', agent).elements['#content'].innerHTML;
    assert.ok(html.includes(`Suggested for this device: ${platform}`));
    assert.ok(html.includes('Not released'));
    assert.doesNotMatch(html, /<a\b/i);
  }
});
