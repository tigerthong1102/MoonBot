import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['index.html', 'site.js', 'style.css', 'logo.png']) await copyFile(join(root, file), join(out, file));
for (const route of ['download', 'docs', 'support', 'releases', 'privacy', 'terms']) {
  await mkdir(join(out, route), { recursive: true });
  await copyFile(join(root, 'index.html'), join(out, route, 'index.html'));
}
