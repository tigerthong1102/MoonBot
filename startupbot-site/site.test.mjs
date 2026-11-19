import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = dirname(fileURLToPath(import.meta.url));
const site = mkdtempSync(join(tmpdir(),'startupbot-site-test-'));
after(() => rmSync(site,{recursive:true,force:true}));
for (const file of ['index.html','build.mjs','site.js','style.css','mark.png','theme.js','desktop-preview.png','desktop-preview-vi.png','downloads.json','locales','web-page.mjs','site-locales.mjs','workspace.mjs','cloud-view.mjs','web']) {
  cpSync(join(source,file),join(site,file),{recursive:true});
}
function build(...args) {
  execFileSync(process.execPath,[join(site,'build.mjs'),...args],{stdio:'pipe'});
}
const catalog = JSON.parse(readFileSync(join(site,'downloads.json'),'utf8'));
const allFiles = catalog.flatMap(group => group.files);
const locales = readdirSync(join(site,'locales')).map(file => JSON.parse(readFileSync(join(site,'locales',file),'utf8')));
function page(lang, route) {
  return readFileSync(join(site,'dist',lang === 'vi' ? '' : lang,route,'index.html'),'utf8');
}
test('every locale includes complete content and links to the same route in all languages', () => {
  build();
  for (const t of locales) {
    assert.deepEqual(Object.keys(t).sort(),Object.keys(locales[0]).sort());
    assert.deepEqual(Object.keys(t.platformDetails).sort(),catalog.map(p => p.id).sort());
    for (const route of ['','download','docs','privacy','terms','support','releases','app/local']) {
      const html = page(t.lang,route);
      assert.ok(html.includes('<html lang="'+t.lang+'">'));
      for (const l of locales) {
        const path = [l.lang === 'vi' ? '' : l.lang,route].filter(Boolean).join('/');
        assert.ok(html.includes('href="/'+(path ? path+'/' : '')+'" lang="'+l.lang+'"'));
      }
      assert.doesNotMatch(html,/undefined|\{\{|href="\/files\//);
    }
  }
});
test('each website language supplies the same nested UI messages and its own workspace preview', () => {
  function keys(value, path = '') {
    if (typeof value === 'string') {
      assert.ok(value.trim(), path);
      return [path];
    }
    return Object.entries(value).flatMap(([name, child]) => keys(child, path + '/' + name)).sort();
  }
  const english = locales.find(t => t.lang === 'en');
  for (const locale of locales) {
    assert.deepEqual(keys(locale), keys(english));
    assert.ok(page(locale.lang, '').includes('src="/' + locale.previewImage + '"'));
    assert.ok(readFileSync(join(site, 'dist', locale.previewImage)).length > 0);
  }
});

test('owner preview only links to known unexpired artifacts', () => {
  build('--artifacts');
  for (const t of locales) {
    for (const route of ['','download']) {
      const html = page(t.lang,route);
      assert.ok(html.includes(t.githubNote));
      for (const file of allFiles) {
        assert.match(file.sha256,/^[a-f0-9]{64}$/);
        assert.match(file.artifact.url,/^https:\/\/github\.com\/tigerthong1102\/MoonBot\/actions\/runs\/\d+\/artifacts\/\d+$/);
        assert.equal(html.includes('href="'+file.artifact.url+'"'),Date.parse(file.artifact.expires)>Date.now());
      }
    }
  }
});
test('missing internal payload stops the build', () => {
  assert.throws(()=>build('--installers',join(site,'missing')));
});
test('device suggestions distinguish desktop-mode iPad from a Mac', () => {
  const js = readFileSync(join(site,'site.js'),'utf8');
  for (const [userAgent,maxTouchPoints,id] of [['Macintosh',5,'ios'],['iPhone',1,'ios'],['Android',1,'android'],['Windows NT',0,'win'],['Macintosh',0,'mac']]) {
    const badge = {hidden:true};
    const document = {querySelector:selector => selector === '[data-platform="'+id+'"] .suggested' ? badge : null,querySelectorAll:()=>[]};
    runInNewContext(js,{document,navigator:{userAgent,maxTouchPoints}});
    assert.equal(badge.hidden,false);
  }
});

test('web downloads use same-origin installer URLs and include platform sizes in both languages', () => {
  build('--direct');
  for (const t of locales) {
    for (const route of ['', 'download']) {
      const html = page(t.lang, route);
      assert.ok(html.includes(t.directNote));
      assert.doesNotMatch(html, /actions\/runs|data-expires=|undefined MB/);
      for (const file of allFiles) {
        assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
        assert.ok(html.includes('href="/files/' + file.name + '" download'));
      }
    }
  }
});

test('web chat is opt-in, translated, and reachable from both entry points', () => {
  build('--direct');
  for (const t of locales) {
    const target = (t.lang === 'vi' ? '' : '/' + t.lang) + '/app/';
    for (const route of ['', 'download']) {
      assert.ok(page(t.lang, route).includes('href="' + target + '"'));
      assert.doesNotMatch(page(t.lang, route), /<script[^>]+(?:chat\.js|wllama)/);
    }
    assert.deepEqual(Object.keys(t.web).sort(), Object.keys(locales[0].web).sort());
    const cloud = page(t.lang, 'app');
    assert.ok(cloud.includes('href="/signin-with-chatgpt?return_to='+encodeURIComponent(target)+'"'));
    assert.ok(page(t.lang, 'app/chat').includes('action="'+target+'chat/connect"'));
    assert.doesNotMatch(cloud,/wllama|wasm|491 MB|id="workspace"|web\/chat\.js/);
    assert.ok(cloud.includes('href="'+target+'local/"'));
    const app = page(t.lang, 'app/local');
    assert.ok(app.includes(t.web.consent));
    assert.match(app, /491 MB/);
    assert.match(app, /id="workspace"/);
    assert.doesNotMatch(app, /<iframe|<link[^>]+prefetch|<script[^>]+https:/);
  }
  const wasm = readFileSync(join(site, 'dist/web/runtime-2.3.7/wllama.wasm'));
  assert.equal(wasm.readUInt32BE(0), 0x0061736d);
});

test('exact arithmetic preserves locale, precedence and financial precision', async () => {
  const {calculate} = await import('./web/calculate.js');
  for (const [input,lang,expected] of [
    ['Hai cộng hai bằng bao nhiêu? Chỉ trả lời bằng một chữ số.','vi','4'],
    ['(1250000 + 50000) × 8%','vi','104000'], ['0.1 + 0.2','en','0.3'],
    ['0,1 + 0,2','vi','0,3'],['(9007199254740993 - 1) / 2','en','4503599627370496'],
    ['one plus seven times two','en','15'],['1 / 3','en','≈ 0.333333333333'],
    ['1.000 + 1','vi',null],['1,000 + 1','en',null],['1/0','en',null],
    ['send 2 + 2 invoices','en',null],['2 3 + 4','en',null],['2+3;alert(1)','en',null]
  ]) assert.equal(calculate(input,lang),expected,input);
});

test('workspace invites and local addresses preserve the original destination and reject embedded credentials', async () => {
  const {workspaceAddress} = await import('./web/workspace.js');
  assert.equal(workspaceAddress('https://my.example/pair#code=test').href,'https://my.example/pair#code=test');
  assert.equal(workspaceAddress('http://127.0.0.1:15336/').origin,'http://127.0.0.1:15336');
  for (const invalid of ['javascript:void(0)','http://remote.test','https://a:b@host.test','http://localhost.example','https://a\\b'])
    assert.throws(()=>workspaceAddress(invalid));
});
