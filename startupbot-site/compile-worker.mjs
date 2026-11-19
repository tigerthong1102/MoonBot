import {siteLocales, sitePath, languageLinks} from './site-locales.mjs';
import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = 'dist';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
const assets = [];
async function collect(folder) {
  for (const entry of await readdir(join(root, folder),{withFileTypes:true})) {
    const path = join(folder,entry.name);
    if (entry.isDirectory()) { await collect(path); continue; }
    const ext = extname(path);
    if (!mime[ext]) throw Error('Unexpected file in website build: '+path);
    const bytes = await readFile(join(root,path));
    assets.push(['/'+path.replace(/index\.html$/,''), mime[ext], ['.png','.wasm'].includes(ext) ? bytes.toString('base64') : bytes.toString()]);
  }
}
await collect('');
const files = JSON.parse(await readFile('downloads.json','utf8')).flatMap(group=>group.files);
const worker = [
  'const siteLocales = '+JSON.stringify(siteLocales)+';',
  sitePath.toString(),
  languageLinks.toString(),
  'const assets = new Map('+JSON.stringify(assets)+'.map(([path,type,body])=>[path,{type,body}]));',
  'const files = new Map('+JSON.stringify(files.map(f=>[f.name,{name:f.name,size:f.bytes,sha:f.sha256}]))+');',
  (await readFile('workspace.mjs','utf8')).replace("import {siteLocales, sitePath, languageLinks} from './site-locales.mjs';", '').replace('export function workspacePage','function workspacePage').replace('export async function workspaceWeb','async function workspaceWeb'),
  (await readFile('cloud-view.mjs','utf8')).replace("import {siteLocales, sitePath, languageLinks} from './site-locales.mjs';", '').replaceAll('export function','function'),
  (await readFile('cloud-worker.mjs','utf8')).replace("import {siteLocales, sitePath} from './site-locales.mjs';", '').replace("import { cloudPage } from './cloud-view.mjs';", '').replace('export async function hostedWeb','async function hostedWeb'),
  await readFile('download-worker.mjs','utf8')
].join('\n');
await rm(root,{recursive:true});
await mkdir(join(root,'server'),{recursive:true});
await writeFile(join(root,'server/index.js'),worker);
await mkdir(join(root,'.openai'));
await cp('.openai/hosting.json',join(root,'.openai/hosting.json'));
