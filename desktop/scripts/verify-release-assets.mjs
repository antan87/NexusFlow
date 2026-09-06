import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value?.startsWith('--')) args.set(value.slice(2), process.argv[index + 1]);
}

const platform = args.get('platform');
const outputDir = path.resolve(args.get('dir') || 'dist');
if (platform !== 'windows' && platform !== 'linux') {
  throw new Error('Usage: node verify-release-assets.mjs --platform windows|linux --dir <electron-builder-output>');
}

const metadataName = platform === 'windows' ? 'latest.yml' : 'latest-linux.yml';
const metadataPath = path.join(outputDir, metadataName);
if (!existsSync(metadataPath)) throw new Error(`Missing required updater metadata: ${metadataPath}`);

const unpackedBinary = platform === 'windows'
  ? (existsSync(path.join(outputDir, 'win-unpacked', 'ContextSpace.exe'))
      ? path.join(outputDir, 'win-unpacked', 'ContextSpace.exe')
      : path.join(outputDir, 'win-unpacked', 'NexusFlow.exe'))
  : (existsSync(path.join(outputDir, 'linux-unpacked', 'contextspace-desktop'))
      ? path.join(outputDir, 'linux-unpacked', 'contextspace-desktop')
      : path.join(outputDir, 'linux-unpacked', 'nexusflow-desktop'));
if (!existsSync(unpackedBinary)) {
  throw new Error(`Missing required unpacked ${platform} binary: ${unpackedBinary}`);
}

const assetNames = readdirSync(outputDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => platform === 'windows'
    ? (name === 'ContextSpaceSetup.exe' || name === 'NexusFlowSetup.exe')
    : /^(ContextSpace|NexusFlow)-[^/]+\.AppImage$/.test(name));

if (assetNames.length !== 1) {
  throw new Error(`Expected exactly one ${platform} desktop artifact in ${outputDir}; found ${assetNames.join(', ') || '(none)'}`);
}

const metadata = readFileSync(metadataPath, 'utf8');
if (!metadata.includes(assetNames[0])) {
  throw new Error(`${metadataName} does not reference ${assetNames[0]}`);
}

console.log(`[verify-release-assets] OK — ${assetNames[0]} is referenced by ${metadataName}; unpacked binary exists at ${unpackedBinary}`);
