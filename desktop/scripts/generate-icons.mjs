import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source of truth: gui/public/favicon.svg. Run from desktop/ with
// `npm run generate-icons`; Electron renders the source in a hidden window.
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const RENDER_SIZE = 512;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(desktopDir, '..');
const sourcePath = path.join(repoDir, 'gui', 'public', 'favicon.svg');
const outputDir = path.join(desktopDir, 'assets');
const pngPath = path.join(outputDir, 'icon.png');
const icoPath = path.join(outputDir, 'icon.ico');

function makeIco(images) {
  const headerSize = 6;
  const directorySize = images.length * 16;
  const imageOffset = headerSize + directorySize;
  const directory = Buffer.alloc(directorySize);
  let offset = imageOffset;

  for (const [index, image] of images.entries()) {
    const entryOffset = index * 16;
    const dimension = image.size === 256 ? 0 : image.size;
    directory.writeUInt8(dimension, entryOffset);
    directory.writeUInt8(dimension, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2); // Use PNG's own color information.
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4); // Planes.
    directory.writeUInt16LE(32, entryOffset + 6); // 32-bit RGBA PNG payload.
    directory.writeUInt32LE(image.data.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += image.data.length;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved.
  header.writeUInt16LE(1, 2); // Icon resource.
  header.writeUInt16LE(images.length, 4);
  return Buffer.concat([header, directory, ...images.map(({ data }) => data)]);
}

function imageReady(window) {
  return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = document.querySelector('img');
    if (!image) {
      reject(new Error('SVG image element was not created'));
      return;
    }
    if (image.complete) {
      if (image.naturalWidth > 0) resolve();
      else reject(new Error('SVG image failed to load'));
      return;
    }
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', () => reject(new Error('SVG image failed to load')), { once: true });
  })`);
}

async function renderSource(svg) {
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const html = `<!doctype html>
    <meta charset="utf-8">
    <style>
      html, body { width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; margin: 0; overflow: hidden; background: transparent; }
      img { display: block; width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; }
    </style>
    <img alt="" width="${RENDER_SIZE}" height="${RENDER_SIZE}" src="${svgDataUrl}">`;

  const window = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await imageReady(window);
    const dataUrl = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = ${RENDER_SIZE};
      canvas.height = ${RENDER_SIZE};
      const context = canvas.getContext('2d', { alpha: true });
      context.clearRect(0, 0, ${RENDER_SIZE}, ${RENDER_SIZE});
      context.drawImage(document.querySelector('img'), 0, 0, ${RENDER_SIZE}, ${RENDER_SIZE});
      return canvas.toDataURL('image/png');
    })()`);
    const image = nativeImage.createFromDataURL(dataUrl);
    const size = image.getSize();
    if (size.width !== RENDER_SIZE || size.height !== RENDER_SIZE) {
      throw new Error(`Electron rendered ${size.width}x${size.height}; expected ${RENDER_SIZE}x${RENDER_SIZE}`);
    }
    return image;
  } finally {
    window.destroy();
  }
}

async function main() {
  if (!existsSync(sourcePath)) throw new Error(`Missing SVG source: ${sourcePath}`);
  mkdirSync(outputDir, { recursive: true });

  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'contextspace-icon-generator-'));
  let exitCode = 0;
  try {
    // Keep Chromium state out of the developer's real Electron profile.
    app.setPath('userData', profileDir);
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    app.disableHardwareAcceleration();
    await app.whenReady();

    const source = readFileSync(sourcePath, 'utf8');
    const rendered = await renderSource(source);
    const images = ICON_SIZES.map((size) => ({
      size,
      data: rendered.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    }));

    writeFileSync(pngPath, rendered.toPNG());
    writeFileSync(icoPath, makeIco(images));
    console.log(`Generated ${path.relative(repoDir, pngPath)} and ${path.relative(repoDir, icoPath)} from ${path.relative(repoDir, sourcePath)}`);
    console.log(`ICO sizes: ${ICON_SIZES.join(', ')}px`);
  } catch (error) {
    exitCode = 1;
    console.error(error instanceof Error ? error.message : error);
  } finally {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Electron may still hold a profile lock briefly on Windows.
    }
    if (app.isReady()) app.exit(exitCode);
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  app.exit(1);
});
