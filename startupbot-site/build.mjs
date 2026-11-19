import {siteLocales} from './site-locales.mjs';
import { workspacePage } from './workspace.mjs';
import { cloudPage } from './cloud-view.mjs';
import { webPage } from './web-page.mjs';
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { values: { installers, artifacts, direct } } = parseArgs({ options: { installers: { type: 'string' }, artifacts: { type: 'boolean' }, direct: { type: 'boolean' } } });
if ([installers, artifacts, direct].filter(Boolean).length > 1) throw new Error('Choose one distribution mode');
const output = join(root, installers ? 'dist-internal' : 'dist');
const languages = Object.values(siteLocales);
const catalog = JSON.parse(await readFile(join(root, 'downloads.json'), 'utf8'));
const template = await readFile(join(root, 'index.html'), 'utf8');
const routes = ['', 'download', 'docs', 'support', 'app', 'app/chat', 'app/local', 'releases', 'privacy', 'terms'];
function url(lang, route = '') {
  return '/' + [lang === 'vi' ? '' : lang, route].filter(Boolean).map(part => part + '/').join('');
}
function nav(lang, route, label) {
  return '<a href="' + url(lang, route) + '">' + label + '</a>';
}
function downloads(t, compact = false) {
  const platforms = catalog.map(platform => {
    const files = platform.files.map(file => (installers || direct)
      ? `<a class="file" aria-label="${t.download} ${t.platformNames[platform.id]} · ${file.label} (${file.format})" href="/files/${file.name}" download>${compact ? file.label : t.download + " · " + file.label}<small>${file.format} · ${(file.bytes / 1e6).toLocaleString(t.lang, {maximumFractionDigits: 1})} MB ↓</small></a>` : artifacts && file.artifact && Date.parse(file.artifact.expires) > Date.now()
        ? `<a class="file" aria-label="${t.download} ${t.platformNames[platform.id]} · ${file.label} (${file.format})" href="${file.artifact.url}" data-expires="${file.artifact.expires}">${compact ? file.label : t.download + " · " + file.label}<small>${file.format} ↗</small></a>` : '').join('');
    const guide = platform.id === 'mac' ? `<a class="guide-link" href="${url(t.lang, 'docs')}#mac">${t.macGuide} →</a>` : '';
    const notes = `<p>${t.platformDetails[platform.id]}</p>${guide}`;
    return `<article class="platform" data-platform="${platform.id}"><div class="titles"><h3>${t.platformNames[platform.id]}</h3><span class="platform-version">${platform.version}</span></div>
    <span class="suggested" hidden>${t.suggested}</span><div class="filebox">${files || '<p>' + t.unavailable + '</p>'}</div>
    ${compact ? `<details class="install"><summary>${t.installNotes}</summary>${notes}</details>` : notes}</article>`;
  }).join('');
  return `<section class="download-section ${compact ? 'compact' : ''}" id="downloads" data-expired="${t.unavailable}"><div class="download-heading"><h2>${t.downloadTitle}</h2><span class="kind">${t.internal}</span></div>
  <div class="platforms">${platforms}</div><p class="note">${direct ? t.directNote : artifacts ? t.githubNote : t.downloadIntro} ${compact ? '' : t.linuxNote}</p></section>`;
}
function useCases(t) {
  const links = t.cases.map(([label], i) => `<a id="case-link-${i}" href="#case-${i}">${label}</a>`).join('');
  const panels = t.cases.map(([label, title, body, prompt], i) => `<article id="case-${i}" class="case-panel">
    <div><h3>${title}</h3><p>${body}</p></div><blockquote><small>${t.example}</small>${prompt}</blockquote></article>`).join('');
  return `<section class="section" id="features"><h2>${t.casesTitle}</h2><nav class="case-nav" aria-label="${t.caseNav}">${links}</nav>${panels}</section>`;

}
function render(t, route) {
  if (route === 'app') return workspacePage(t.lang);
  if (route === 'app/chat') return cloudPage(t.lang);
  const home = url(t.lang);
  const brand = `<a class="brand" href="${home}"><img src="/mark.png" width="37" height="37" alt="">StartupBot</a>`;
  const locales = languages.map(l => `<a href="${url(l.lang, route)}" lang="${l.lang}" hreflang="${l.lang}" ${l.lang === t.lang ? 'aria-current="page"' : ''}>${l.language}</a>`).join('');
  const header = `<header class="wrap">${brand}<nav class="nav"><a href="${home}#features">${t.navProduct}</a>${nav(t.lang,'app',t.web.cta)}${nav(t.lang,'docs',t.navDocs)}${nav(t.lang,'download',t.navDownload)}</nav><button id="theme" type="button" aria-label="${t.themeLabel}" title="${t.themeLabel}"><span aria-hidden="true" class="sun">☀</span><span aria-hidden="true" class="moon">☾</span></button><details><summary aria-label="${t.languageLabel} · ${t.language}">${t.lang.toUpperCase()} ⌄</summary><div class="languages">${locales}</div></details></header>`;
  const footer = `<footer class="wrap">${brand}<nav>${['releases','privacy','terms','support'].map(r => nav(t.lang, r, t[r+'Title'])).join('')}</nav></footer>`;
  let main;
  if (!route) {
    const preview = t.previewImage;
    const features = t.features.map(([title, text], i) => `<article class="feature"><i aria-hidden="true">${['⌘','↻','⇄'][i]}</i><h3>${title}</h3><p>${text}</p></article>`).join('');
    main = `<section class="hero"><div class="hero-copy"><span class="kicker">${t.localFirst}</span><h1>${t.heading}<br><em>${t.ending}</em></h1><p>${t.intro}</p><div class="actions"><a class="button" href="#downloads">${t.downloadCta} ↓</a><a class="quiet" href="${url(t.lang,'app')}">${t.web.cta} →</a></div></div><figure class="visual"><a class="app-shot" href="/${preview}" aria-label="${t.zoom}"><img src="/${preview}" width="1040" height="760" alt="${t.previewLabel}"></a><figcaption>${t.previewLabel}<a href="/${preview}">${t.zoom} ↗</a></figcaption></figure></section>
    ${downloads(t, true)}${useCases(t)}<section class="section"><h2>${t.featureTitle}</h2><div class="features">${features}</div></section>`;
  } else if (route === 'app/local') {
    main = webPage(t);
  } else if (route === 'download') {
    main = '<div class="download-page"><div class="web-cta">' + nav(t.lang,'app',t.web.cta+' →') + '</div>' + downloads(t).replace('<h2>', '<h1>').replace('</h2>', '</h1>') + '</div>';
  } else {
    const action = route === 'support' ? `<a class="button" href="https://github.com/tigerthong1102/MoonBot/issues">${t.issues} ↗</a>` : nav(t.lang, 'download', t.navDownload + ' →');
    const macGuide = route === 'docs' ? `<section class="section" id="mac"><h2>${t.macGuide}</h2><p>${t.macSteps}</p>
      <p><a class="guide-link" href="https://support.apple.com/${t.lang === 'vi' ? 'vi-vn' : 'en-us'}/102445">${t.appleHelp} ↗</a></p>
      <h3>${t.macDigest}</h3>${catalog.find(group => group.id === 'mac').files.map(file => `<p>${file.label} <code>${file.sha256}</code></p>`).join('')}</section>` : '';
    main = `<section class="page"><h1>${t[route+'Title']}</h1><p>${t[route+'Body']}</p><div class="actions">${action}</div>${macGuide}</section>`;
  }
  return template.replace('{{lang}}',t.lang).replace('{{description}}',t.intro).replace('{{title}}', route === 'app/local' ? t.web.startTitle : route ? t[route+'Title'] : t.title).replace('{{body}}',header+'<main class="wrap">'+main+'</main>'+footer);
}

await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for (const name of ['mark.png','desktop-preview.png','desktop-preview-vi.png','theme.js','style.css','site.js']) await copyFile(join(root,name),join(output,name));
await cp(join(root,'web'),join(output,'web'),{recursive:true});
if (installers) {
  const dir = join(output,'files');
  await mkdir(dir);
  for (const file of catalog.flatMap(platform => platform.files)) {
    const target = join(dir,file.name);
    await copyFile(join(installers,file.name),target);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256) {
      await rm(dir,{recursive:true});
      throw new Error('Invalid SHA256: ' + file.name);
    }
    console.log(file.name, (await stat(target)).size, 'bytes verified');
  }
}
for (const t of languages) {
  for (const route of routes) {
    const dir = join(output,url(t.lang,route));
    await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'index.html'),render(t,route));
  }
}
