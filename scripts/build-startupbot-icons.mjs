import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artwork = readFileSync(path.join(root, "branding/startupbot-app-icon.svg"), "utf8")
  .replace('xlink:href="startupbot-original.png"', `xlink:href="data:image/png;base64,${readFileSync(path.join(root, "branding/startupbot-original.png")).toString("base64")}"`);
const png = size => {
  const rendered = new Resvg(artwork, { fitTo: { mode: "width", value: size } }).render();
  if (rendered.width !== size || rendered.height !== size) throw new Error(`Incorrect icon dimensions for ${size}`);
  if (rendered.pixels[3] !== 0) throw new Error("The icon's outer corner must be transparent");
  return rendered.asPng();
};
const sizes = new Map([16, 32, 40, 48, 56, 64, 88, 128, 180, 192, 256, 512, 1024].map(size => [size, png(size)]));
for (const [file, size] of Object.entries({
  "build/startupbot.png": 512, "build/icon-1024.png": 1024,
  "electron/resources/startupbot-icon.png": 512, "electron/resources/app-icon.png": 512,
  "public/startupbot-icon-180.png": 180, "public/apple-touch-icon.png": 180,
  "public/startupbot-icon-192.png": 192, "public/app-icon-192.png": 192,
  "public/startupbot-icon-512.png": 512, "public/app-icon-512.png": 512,
})) writeFileSync(path.join(root, file), sizes.get(size));
mkdirSync(path.join(root, "src/assets/startupbot"), { recursive: true });
for (const size of [40, 56, 88, 128, 192, 256]) {
  writeFileSync(path.join(root, `src/assets/startupbot/cursor-${size}.png`), sizes.get(size));
}
const chunks = Object.entries({ icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }).map(([kind, size]) => {
  const image = sizes.get(size);
  const header = Buffer.alloc(8); header.write(kind); header.writeUInt32BE(image.length + 8, 4);
  return Buffer.concat([header, image]);
});
const icnsHeader = Buffer.alloc(8); icnsHeader.write("icns"); icnsHeader.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, 8), 4);
const icns = Buffer.concat([icnsHeader, ...chunks]);
for (const file of ["build/startupbot.icns", "build/icon.icns"]) writeFileSync(path.join(root, file), icns);
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = icoHeader.length;
for (const [index, size] of icoSizes.entries()) {
  const entry = 6 + index * 16;
  icoHeader[entry] = size === 256 ? 0 : size; icoHeader[entry + 1] = icoHeader[entry];
  icoHeader.writeUInt16LE(1, entry + 4); icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(sizes.get(size).length, entry + 8); icoHeader.writeUInt32LE(offset, entry + 12);
  offset += sizes.get(size).length;
}
const ico = Buffer.concat([icoHeader, ...icoSizes.map(size => sizes.get(size))]);
for (const file of ["build/startupbot.ico", "build/icon.ico"]) writeFileSync(path.join(root, file), ico);
mkdirSync(path.join(root, "build/icon.iconset"), { recursive: true });
for (const size of [16, 32, 64, 128, 256, 512]) {
  writeFileSync(path.join(root, `build/icon.iconset/icon_${size}x${size}.png`), sizes.get(size));
  writeFileSync(path.join(root, `build/icon.iconset/icon_${size}x${size}@2x.png`), sizes.get(size * 2));
}
console.log("StartupBot macOS, Windows, PWA and in-app icons generated from the owner-supplied artwork");
