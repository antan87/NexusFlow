// Render the current GUI brand mark into the desktop and fallback web icons.
// Run: npm run icons --prefix desktop (requires Playwright Chromium).
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const sizes = [16, 32, 48, 64, 128, 256, 512];
const svg = await readFile(new URL('gui/public/favicon.svg', root), 'utf8');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const images = [];
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    images.push({ size, png });
    await writeFile(new URL(`brand-assets/contextspace-icon-${size}.png`, root), png);
    await page.close();
  }
} finally {
  await browser.close();
}

// ICO directory entries point to lossless PNG frames (Windows Vista and newer).
const frames = images.filter(({ size }) => size <= 256);
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, png }, i) => {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...frames.map(({ png }) => png)]);
for (const target of ['desktop/assets/icon.ico', 'gui/public/favicon.ico', 'brand-assets/favicon.ico']) {
  await writeFile(new URL(target, root), ico);
}
for (const target of ['desktop/assets/icon.png', 'gui/public/app_logo.png']) {
  await writeFile(new URL(target, root), images.at(-1).png);
}
console.log(`Generated desktop and web icons from ${fileURLToPath(new URL('gui/public/favicon.svg', root))}`);
