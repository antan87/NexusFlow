import { execSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distInstallerDir = path.resolve(__dirname, 'dist-installer');
const nodeStagingDir = path.resolve(distInstallerDir, 'node');
const serverStagingDir = path.resolve(distInstallerDir, 'server');
const outputDir = path.resolve(__dirname, 'dist-installer-output');

const nodeExeUrl = 'https://nodejs.org/dist/v20.15.0/win-x64/node.exe';
const nodeExePath = path.resolve(nodeStagingDir, 'node.exe');

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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${destPath}...`);
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('Download complete.');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

function retryRmSync(dir, maxRetries = 5, delay = 150) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.log(`Directory ${path.basename(dir)} locked by OS, retrying deletion (${i + 1}/${maxRetries}) in ${delay}ms...`);
      sleepSync(delay);
    }
  }
}

function pruneNodeModules(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nameLower = entry.name.toLowerCase();
      if (
        nameLower === 'test' ||
        nameLower === 'tests' ||
        nameLower === 'examples' ||
        nameLower === 'docs' ||
        nameLower === '.github'
      ) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        pruneNodeModules(fullPath);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.map' || ext === '.ts' || ext === '.md') {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

async function build() {
  try {
    console.log('--- Starting NexusFlow Installer Build ---');

    // 1. Re-create clean staging directories with OS lock retry handling
    console.log('Cleaning and creating staging directories...');
    retryRmSync(distInstallerDir);
    fs.mkdirSync(distInstallerDir, { recursive: true });
    fs.mkdirSync(nodeStagingDir, { recursive: true });
    fs.mkdirSync(serverStagingDir, { recursive: true });

    try {
      retryRmSync(outputDir);
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (err) {
      console.log('Output directory locked by shell, clearing files inside instead...');
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          fs.rmSync(path.join(outputDir, file), { recursive: true, force: true });
        }
      } else {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    }

    // 2. Copy Neutralino assets
    console.log('Copying Neutralino assets...');
    const winExeSrc = path.resolve(__dirname, 'dist/nexusflow-desktop/nexusflow-desktop-win_x64.exe');
    const resourcesNeuSrc = path.resolve(__dirname, 'dist/nexusflow-desktop/resources.neu');

    if (!fs.existsSync(winExeSrc) || !fs.existsSync(resourcesNeuSrc)) {
      throw new Error('Neutralino build outputs not found. Please run "npm run build" first in the desktop folder.');
    }

    fs.copyFileSync(winExeSrc, path.resolve(distInstallerDir, 'nexusflow-desktop-win_x64.exe'));
    fs.copyFileSync(resourcesNeuSrc, path.resolve(distInstallerDir, 'resources.neu'));

    // 3. Copy Hono backend server files
    console.log('Copying Hono server dist and package.json...');
    const serverDistSrc = path.resolve(__dirname, '../NexusFlow/dist');
    const serverPackageJsonSrc = path.resolve(__dirname, '../NexusFlow/package.json');

    if (!fs.existsSync(serverDistSrc) || !fs.existsSync(serverPackageJsonSrc)) {
      throw new Error('NexusFlow server build outputs not found. Please run "npm run build" first in NexusFlow.');
    }

    copyDir(serverDistSrc, path.resolve(serverStagingDir, 'dist'));
    fs.copyFileSync(serverPackageJsonSrc, path.resolve(serverStagingDir, 'package.json'));

    // Copy templates/resources
    const serverResourcesSrc = path.resolve(__dirname, '../NexusFlow/resources');
    if (fs.existsSync(serverResourcesSrc)) {
      copyDir(serverResourcesSrc, path.resolve(serverStagingDir, 'resources'));
    }

    // 4. Install server dependencies and prune unused assets
    console.log('Installing production dependencies for staging server...');
    execSync('npm install --omit=dev', { cwd: serverStagingDir, stdio: 'inherit' });
    
    console.log('Pruning non-runtime files from node_modules (maps, tests, docs)...');
    pruneNodeModules(path.resolve(serverStagingDir, 'node_modules'));

    // 5. Download embedded Node.js executable
    await downloadFile(nodeExeUrl, nodeExePath);

    // 6. Locate and run Inno Setup compiler (ISCC.exe)
    console.log('Locating Inno Setup compiler...');
    const userIsccPath = path.join(
      process.env.USERPROFILE || 'C:\\Users\\default',
      'AppData\\Local\\Programs\\Inno Setup 6\\ISCC.exe'
    );
    const globalIsccPath = 'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe';

    let isccPath = '';
    if (fs.existsSync(userIsccPath)) {
      isccPath = userIsccPath;
    } else if (fs.existsSync(globalIsccPath)) {
      isccPath = globalIsccPath;
    } else {
      // Try resolving from PATH
      try {
        execSync('iscc /?', { stdio: 'ignore' });
        isccPath = 'iscc';
      } catch {
        throw new Error('Inno Setup compiler (ISCC.exe) not found. Please verify it is installed.');
      }
    }

    console.log(`Using Inno Setup compiler: ${isccPath}`);
    const issScriptPath = path.resolve(__dirname, 'installer/nexusflow.iss');
    console.log(`Compiling installer script: ${issScriptPath}...`);
    execSync(`"${isccPath}" "${issScriptPath}"`, { stdio: 'inherit' });

    // 7. Check if file got redirected to VirtualStore due to Windows virtualization and move it back
    const expectedOutputExe = path.resolve(outputDir, 'NexusFlowSetup.exe');
    if (!fs.existsSync(expectedOutputExe)) {
      console.log('Checking for Windows VirtualStore redirection...');
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\default', 'AppData\\Local');
      // VirtualStore mirrors the absolute path starting from the drive root
      const relativePathFromDrive = __dirname.replace(/^[a-zA-Z]:/, '');
      const virtualStorePath = path.join(localAppData, 'VirtualStore', relativePathFromDrive, 'dist-installer-output', 'NexusFlowSetup.exe');
      
      if (fs.existsSync(virtualStorePath)) {
        console.log(`Detected VirtualStore redirection! Moving installer from ${virtualStorePath} to ${expectedOutputExe}...`);
        fs.copyFileSync(virtualStorePath, expectedOutputExe);
        fs.unlinkSync(virtualStorePath);
      } else {
        throw new Error('Installer compiled successfully but the output file could not be found anywhere.');
      }
    }

    console.log('--- Installer Build Completed Successfully ---');
    console.log(`Installer location: ${expectedOutputExe}`);
  } catch (error) {
    console.error('Installer build failed:', error.message);
    process.exit(1);
  }
}

build();
