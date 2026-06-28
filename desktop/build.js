import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parentDir = path.resolve(__dirname, '../NexusFlow');
const guiAssetsDir = path.resolve(parentDir, 'dist/gui');
const resourcesDir = path.resolve(__dirname, 'resources');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  const binDir = path.resolve(__dirname, 'bin');
  const neutralinoJsPath = path.resolve(resourcesDir, 'neutralino.js');

  // Check if bin directory or resources/neutralino.js is missing
  if (!fs.existsSync(binDir) || !fs.existsSync(neutralinoJsPath)) {
    console.log('Detected missing Neutralino binaries or client library. Running npx neu update...');
    try {
      execSync('npx --no-install neu update', { cwd: __dirname, stdio: 'inherit' });
    } catch (err) {
      console.log('npx failed, trying direct node execution of local neu CLI binary for update...');
      const localNeuBin = path.join(__dirname, 'node_modules/@neutralinojs/neu/bin/neu');
      if (fs.existsSync(localNeuBin)) {
        execSync(`node "${localNeuBin}" update`, { cwd: __dirname, stdio: 'inherit' });
      } else {
        throw new Error('Local neutralino CLI binary not found. Please run npm install first in the desktop directory.');
      }
    }
  }

  // 1. Compile the parent project
  console.log('Compiling parent project (NexusFlow)...');
  execSync('npm run build', { cwd: parentDir, stdio: 'inherit' });

  // Read existing neutralino.js before purging resources folder
  let neutralinoJsContent = '';
  if (fs.existsSync(neutralinoJsPath)) {
    console.log('Reading existing neutralino.js into memory...');
    neutralinoJsContent = fs.readFileSync(neutralinoJsPath, 'utf8');
  }

  // 2. Clear and copy GUI assets to desktop/resources
  console.log('Copying web assets to desktop/resources...');
  if (fs.existsSync(resourcesDir)) {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resourcesDir, { recursive: true });
  copyDir(guiAssetsDir, resourcesDir);

  // Write neutralino.js back to resources directory
  if (neutralinoJsContent) {
    console.log('Writing neutralino.js back to resources folder...');
    fs.writeFileSync(neutralinoJsPath, neutralinoJsContent, 'utf8');
  }

  // 3. Inject neutralino.js client script tag
  console.log('Injecting neutralino.js client script tag into index.html...');
  const indexHtmlPath = path.join(resourcesDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    let htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
    if (!htmlContent.includes('neutralino.js')) {
      // Inject before </head>
      htmlContent = htmlContent.replace('</head>', '<script src="/neutralino.js"></script>\n</head>');
      fs.writeFileSync(indexHtmlPath, htmlContent, 'utf8');
      console.log('Successfully injected neutralino.js.');
    } else {
      console.log('neutralino.js already injected.');
    }
  } else {
    console.error('Error: index.html not found in resources directory!');
    process.exit(1);
  }

  // 4. Execute neu build using the locally installed CLI binary
  console.log('Executing neu build using locally installed CLI binary...');
  try {
    execSync('npx --no-install neu build', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.log('npx failed, trying direct node execution of local neu CLI binary...');
    const localNeuBin = path.join(__dirname, 'node_modules/@neutralinojs/neu/bin/neu');
    if (fs.existsSync(localNeuBin)) {
      execSync(`node "${localNeuBin}" build`, { cwd: __dirname, stdio: 'inherit' });
    } else {
      throw new Error('Local neutralino CLI binary not found. Please run npm install first in the desktop directory.');
    }
  }

  console.log('Build completed successfully.');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
