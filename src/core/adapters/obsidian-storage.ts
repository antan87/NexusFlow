import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StoragePort, StorageAdapterMeta } from '../ports/storage.js';

/**
 * Obsidian-native storage adapter.
 *
 * Writes markdown files to a configurable Obsidian vault path with optional
 * YAML frontmatter (tags, dates, type). Uses the same two-layer structure
 * as CentralVaultAdapter (_base/<repo>/ + <workspace>/).
 */
export class ObsidianStorageAdapter implements StoragePort {
  readonly meta: StorageAdapterMeta = {
    name: 'obsidian',
    displayName: 'Obsidian Vault',
    description: 'Store context in an Obsidian vault with YAML frontmatter and wikilinks.',
    configFields: [
      {
        key: 'vaultPath',
        label: 'Obsidian Vault Path',
        type: 'path',
        required: true,
        description: 'Absolute path to your Obsidian vault folder (e.g. ~/Obsidian/Dev)',
      },
      {
        key: 'addFrontmatter',
        label: 'Add YAML Frontmatter',
        type: 'boolean',
        default: true,
        description: 'Add tags, created date, and type metadata to each file',
      },
    ],
  };

  private vaultPath: string = '';
  private addFrontmatter: boolean = true;

  constructor() {
    try {
      const home = os.homedir();
      if (home) {
        this.vaultPath = path.join(home, 'Obsidian', 'NexusFlow');
      }
    } catch {}
  }

  configure(settings: Record<string, unknown>): void {
    if (settings.vaultPath && typeof settings.vaultPath === 'string') {
      this.vaultPath = settings.vaultPath.startsWith('~')
        ? path.join(os.homedir(), settings.vaultPath.slice(1))
        : settings.vaultPath;
    }
    if (typeof settings.addFrontmatter === 'boolean') {
      this.addFrontmatter = settings.addFrontmatter;
    }
  }

  // ── Frontmatter helpers ──────────────────────────────────

  private wrapWithFrontmatter(content: string, tags: string[], type: string): string {
    if (!this.addFrontmatter) return content;

    const now = new Date().toISOString();
    const fm = [
      '---',
      `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
      `type: ${type}`,
      `created: ${now}`,
      `modified: ${now}`,
      `generator: nexusflow`,
      '---',
      '',
    ].join('\n');

    // Strip existing frontmatter if present
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
    return fm + stripped;
  }

  // ── Workspace (feature) layer ────────────────────────────

  private getFeaturePath(featureId: string): string {
    return path.join(this.vaultPath, 'nexusflow', 'workspaces', featureId);
  }

  async writeWorkspaceFile(workspacePath: string, featureId: string, filename: string, content: string): Promise<void> {
    const dir = this.getFeaturePath(featureId);
    const filePath = path.join(dir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const wrapped = this.wrapWithFrontmatter(content, [featureId, 'workspace'], 'workspace-context');
    await fs.writeFile(filePath, wrapped, 'utf8');
  }

  async readWorkspaceFile(workspacePath: string, featureId: string, filename: string): Promise<string> {
    const dir = this.getFeaturePath(featureId);
    return await fs.readFile(path.join(dir, filename), 'utf8');
  }

  async workspaceFileExists(workspacePath: string, featureId: string, filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.getFeaturePath(featureId), filename));
      return true;
    } catch {
      return false;
    }
  }

  resolveWorkspaceFileUrl(workspacePath: string, featureId: string, filename: string): string {
    return path.join(this.getFeaturePath(featureId), filename).replace(/\\/g, '/');
  }

  // ── Base (repo) layer ────────────────────────────────────

  private getBasePath(repoName: string): string {
    return path.join(this.vaultPath, 'nexusflow', '_base', repoName);
  }

  async writeBaseFile(workspacePath: string, repoName: string, filename: string, content: string): Promise<void> {
    const dir = this.getBasePath(repoName);
    const filePath = path.join(dir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const wrapped = this.wrapWithFrontmatter(content, [repoName, 'base'], 'base-knowledge');
    await fs.writeFile(filePath, wrapped, 'utf8');
  }

  async readBaseFile(workspacePath: string, repoName: string, filename: string): Promise<string> {
    const dir = this.getBasePath(repoName);
    return await fs.readFile(path.join(dir, filename), 'utf8');
  }

  async baseFileExists(workspacePath: string, repoName: string, filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.getBasePath(repoName), filename));
      return true;
    } catch {
      return false;
    }
  }

  resolveBaseFileUrl(workspacePath: string, repoName: string, filename: string): string {
    return path.join(this.getBasePath(repoName), filename).replace(/\\/g, '/');
  }

  async deleteWorkspace(workspacePath: string, featureId: string): Promise<void> {
    const dir = this.getFeaturePath(featureId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }
}
