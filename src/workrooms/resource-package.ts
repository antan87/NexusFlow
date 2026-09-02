import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { slugify } from '../utils/slug.js';

import {
  WORKROOM_MAX_FILE_BYTES,
  WORKROOM_MAX_PACKAGE_BYTES,
  WORKROOM_MAX_PACKAGE_FILES,
  WORKROOM_MAX_RESOURCE_UPLOAD_BYTES,
  WorkroomValidationError,
  workroomResourcePackageSchema,
  type WorkroomResourceFileV1,
  type WorkroomResourcePackageV1,
} from './contracts.js';

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID_PATH_CHARS = /[\u0000-\u001f<>:"|?*]/u;

function assertPortableUnicodePath(candidate: string): void {
  for (let index = 0; index < candidate.length; index += 1) {
    const codeUnit = candidate.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = candidate.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new WorkroomValidationError('Resource paths cannot contain unpaired UTF-16 surrogate code units.');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new WorkroomValidationError('Resource paths cannot contain unpaired UTF-16 surrogate code units.');
    }
  }
  if (candidate.normalize('NFC') !== candidate) {
    throw new WorkroomValidationError('Resource paths must use NFC-normalized Unicode.');
  }
}

function validateResourcePath(candidate: string): string {
  assertPortableUnicodePath(candidate);
  if (candidate.includes('\\')) {
    throw new WorkroomValidationError(`Resource path is not portable: ${candidate}`);
  }
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
    throw new WorkroomValidationError(`Absolute resource paths are not allowed: ${candidate}`);
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized !== candidate || normalized === '.' || normalized.startsWith('../')) {
    throw new WorkroomValidationError(`Resource path traversal is not allowed: ${candidate}`);
  }
  for (const segment of candidate.split('/')) {
    if (!segment || segment === '.' || segment === '..' || WINDOWS_RESERVED.test(segment) || WINDOWS_INVALID_PATH_CHARS.test(segment)) {
      throw new WorkroomValidationError(`Unsupported resource path segment: ${segment || '(empty)'}`);
    }
    if (Buffer.byteLength(segment, 'utf8') > 255) {
      throw new WorkroomValidationError(`Resource path segment exceeds 255 UTF-8 bytes: ${segment}`);
    }
    if (/[. ]$/.test(segment)) {
      throw new WorkroomValidationError(`Resource path segments cannot end with a dot or space: ${segment}`);
    }
  }
  if (Buffer.byteLength(candidate, 'utf8') > 1_024) {
    throw new WorkroomValidationError('Resource paths are limited to 1,024 UTF-8 bytes.');
  }
  return normalized;
}

function canonicalPackageBytes(pkg: WorkroomResourcePackageV1): Buffer {
  const manifest = {
    schemaVersion: pkg.manifest.schemaVersion,
    kind: pkg.manifest.kind,
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    dependencies: pkg.manifest.dependencies,
    compatibility: pkg.manifest.compatibility,
  };
  const hash = createHash('sha256');
  const updateFrame = (value: string | Buffer) => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  };
  hash.update('NEXUSFLOW-WORKROOM-RESOURCE-V1\0', 'utf8');
  updateFrame(JSON.stringify(manifest));
  const files = [...pkg.files].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const fileCount = Buffer.allocUnsafe(4);
  fileCount.writeUInt32BE(files.length);
  hash.update(fileCount);
  for (const file of files) {
    updateFrame(file.path);
    const mode = Buffer.allocUnsafe(4);
    mode.writeUInt32BE(file.mode ?? 0);
    hash.update(mode);
    updateFrame(Buffer.from(file.contentBase64, 'base64'));
  }
  return hash.digest();
}

function decodeTextFile(pkg: WorkroomResourcePackageV1, filePath: string): string {
  const file = pkg.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new WorkroomValidationError(`Resource package is missing ${filePath}.`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.contentBase64, 'base64'));
  } catch {
    throw new WorkroomValidationError(`Resource file must be valid UTF-8: ${filePath}`);
  }
}

function validateExactDefinitionFiles(
  pkg: WorkroomResourcePackageV1,
  definition: Record<string, unknown>,
): void {
  const expected = new Set<string>(['definition.json']);
  if (pkg.manifest.kind === 'skill') {
    expected.add('SKILL.md');
    if (decodeTextFile(pkg, 'SKILL.md') !== definition.content) {
      throw new WorkroomValidationError('SKILL.md must exactly match the reviewed skill definition content.');
    }
    for (const directory of ['references', 'scripts'] as const) {
      const rawEntries = definition[directory];
      if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
        throw new WorkroomValidationError(`Skill ${directory} must be an array when present.`);
      }
      for (const rawEntry of rawEntries ?? []) {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
          throw new WorkroomValidationError(`Skill ${directory} entries must be objects.`);
        }
        const entry = rawEntry as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name : '';
        const relativePath = typeof entry.relativePath === 'string' ? entry.relativePath : '';
        const content = typeof entry.content === 'string' ? entry.content : undefined;
        const exactPath = `${directory}/${name}`;
        if (!name || path.posix.basename(name) !== name || relativePath !== exactPath || content === undefined) {
          throw new WorkroomValidationError(`Skill ${directory} entries must bind name, relativePath, and text content exactly.`);
        }
        if (expected.has(exactPath)) throw new WorkroomValidationError(`Resource definition contains duplicate file ${exactPath}.`);
        expected.add(exactPath);
        const file = pkg.files.find((candidate) => candidate.path === exactPath);
        if (!file || decodeTextFile(pkg, exactPath) !== content) {
          throw new WorkroomValidationError(`Resource definition does not match ${exactPath}.`);
        }
        const definedMode = entry.mode === undefined ? 0 : typeof entry.mode === 'number' ? entry.mode : Number.NaN;
        if (!Number.isInteger(definedMode) || definedMode < 0 || definedMode > 0o777
          || (file.mode ?? 0) !== definedMode) {
          throw new WorkroomValidationError(`Resource definition mode does not match ${exactPath}.`);
        }
      }
    }
  } else if (pkg.manifest.kind === 'agent') {
    // Agents are completely represented by definition.json.
  } else {
    expected.add('WORKFLOW.md');
    expected.add('workflow.json');
    if (decodeTextFile(pkg, 'WORKFLOW.md') !== definition.content) {
      throw new WorkroomValidationError('WORKFLOW.md must exactly match the reviewed workflow definition content.');
    }
    const heading = String(definition.content).split(/\r?\n/).find((line) => line.startsWith('# '));
    if (!heading || slugify(heading.slice(2).trim()) !== pkg.manifest.id) {
      throw new WorkroomValidationError('Workflow Markdown heading must resolve to the reviewed manifest ID.');
    }
    let workflow: unknown;
    try {
      workflow = JSON.parse(decodeTextFile(pkg, 'workflow.json'));
    } catch {
      throw new WorkroomValidationError('workflow.json must contain valid JSON.');
    }
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      throw new WorkroomValidationError('workflow.json must contain an object.');
    }
    const record = workflow as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record.id !== pkg.manifest.id
      || record.version !== pkg.manifest.version || !Array.isArray(record.steps)) {
      throw new WorkroomValidationError('workflow.json must match the manifest ID, version, and schema.');
    }
  }

  if (pkg.files.length !== expected.size || pkg.files.some((file) => !expected.has(file.path))) {
    throw new WorkroomValidationError('Resource package files must exactly match its reviewed definition.');
  }
}

export function digestResourcePackage(pkg: WorkroomResourcePackageV1): string {
  return canonicalPackageBytes(pkg).toString('hex');
}

export function validateResourcePackage(input: unknown): WorkroomResourcePackageV1 {
  const parsed = workroomResourcePackageSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkroomValidationError(`Invalid resource package: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  }
  if (parsed.data.files.length > WORKROOM_MAX_PACKAGE_FILES) {
    throw new WorkroomValidationError(`Resource package exceeds ${WORKROOM_MAX_PACKAGE_FILES} files.`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of parsed.data.files) {
    validateResourcePath(file.path);
    const portableKey = file.path.toLocaleLowerCase('en-US');
    if (seen.has(portableKey)) {
      throw new WorkroomValidationError(`Resource package contains a case-colliding path: ${file.path}`);
    }
    seen.add(portableKey);

    const bytes = Buffer.from(file.contentBase64, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== file.contentBase64.replace(/=+$/, '')) {
      throw new WorkroomValidationError(`Resource file is not valid base64: ${file.path}`);
    }
    if (bytes.length > WORKROOM_MAX_FILE_BYTES) {
      throw new WorkroomValidationError(`Resource file exceeds 5 MiB: ${file.path}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > WORKROOM_MAX_PACKAGE_BYTES) {
      throw new WorkroomValidationError('Resource package exceeds 10 MiB unpacked.');
    }
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > WORKROOM_MAX_RESOURCE_UPLOAD_BYTES) {
    throw new WorkroomValidationError('Resource package exceeds the 16 MiB Workroom transport limit.');
  }
  const digest = digestResourcePackage(parsed.data);
  if (digest !== parsed.data.manifest.digest) {
    throw new WorkroomValidationError('Resource package digest does not match its contents.');
  }

  const definition = parseResourceDefinition(parsed.data);
  if (definition.id !== parsed.data.manifest.id) {
    throw new WorkroomValidationError('Resource definition ID must exactly match the manifest ID.');
  }
  if (typeof definition.name !== 'string' || !definition.name.trim()) {
    throw new WorkroomValidationError('Resource definition must include a non-empty name.');
  }
  if (parsed.data.manifest.kind === 'skill' && definition.name !== parsed.data.manifest.id) {
    throw new WorkroomValidationError('Skill definition name must exactly match the manifest ID.');
  }
  if ((parsed.data.manifest.kind === 'skill' || parsed.data.manifest.kind === 'workflow') && typeof definition.content !== 'string') {
    throw new WorkroomValidationError('Skill and workflow definitions must include their exact text content.');
  }
  if (parsed.data.manifest.kind === 'workflow' && slugify(definition.name) !== parsed.data.manifest.id) {
    throw new WorkroomValidationError('Workflow definition name must resolve to the manifest ID.');
  }
  if (parsed.data.manifest.kind === 'agent' && typeof definition.developerInstructions !== 'string') {
    throw new WorkroomValidationError('Agent definitions must include their exact developer instructions.');
  }
  validateExactDefinitionFiles(parsed.data, definition);

  return parsed.data;
}

/** The only definition that apply is allowed to install; it is a normal reviewed package file. */
export function parseResourceDefinition(pkg: WorkroomResourcePackageV1): Record<string, unknown> {
  const candidates = pkg.files.filter((file) => file.path === 'definition.json');
  if (candidates.length !== 1) {
    throw new WorkroomValidationError('Resource packages must contain exactly one definition.json file.');
  }
  const bytes = Buffer.from(candidates[0]!.contentBase64, 'base64');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WorkroomValidationError('definition.json must be valid UTF-8.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkroomValidationError('definition.json must contain valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkroomValidationError('definition.json must contain a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function makeResourceFile(relativePath: string, content: string | Buffer, mode?: number): WorkroomResourceFileV1 {
  validateResourcePath(relativePath);
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { path: relativePath, contentBase64: bytes.toString('base64'), mode };
}
