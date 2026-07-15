import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { slugify } from './slug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  custom: boolean;
}

function parseMarkdownTemplate(id: string, content: string): Omit<WorkflowTemplate, 'id' | 'custom'> {
  const lines = content.split('\n');
  let name = id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  let description = '';

  // Extract name from the first H1 header (# Name)
  for (const line of lines) {
    if (line.startsWith('# ')) {
      name = line.substring(2).trim();
      break;
    }
  }

  // Extract description from the first non-empty text paragraph below the H1 header
  let foundHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      foundHeader = true;
      continue;
    }
    if (foundHeader && trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
      description = trimmed;
      // Truncate to first sentence or 120 chars
      const sentenceEnd = description.indexOf('.');
      if (sentenceEnd !== -1) {
        description = description.substring(0, sentenceEnd + 1);
      }
      if (description.length > 120) {
        description = description.substring(0, 117) + '...';
      }
      break;
    }
  }

  // Fallbacks for built-in templates if none extracted
  if (!description) {
    if (id === 'plan-implement-review') {
      description = 'Lead planner designs, Code Implementer subagent writes edits, and Code Reviewer subagent tests & reviews in a loop.';
    } else if (id === 'research-verify') {
      description = 'Research specialist subagent analyzes codebase, followed by test-driven developer subagent implementation.';
    } else if (id === 'solo-developer') {
      description = 'Direct coding and verification by the primary agent without subagent delegation overhead.';
    } else {
      description = 'Custom user-defined teamwork strategy.';
    }
  }

  return { name, description, content };
}

async function loadTemplatesFromDir(dirPath: string, custom: boolean): Promise<WorkflowTemplate[]> {
  const templates: WorkflowTemplate[] = [];
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = path.basename(file, '.md');
      const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
      const parsed = parseMarkdownTemplate(id, content);
      templates.push({
        id,
        custom,
        ...parsed,
      });
    }
  } catch (error) {
    // Only log if directory exists (ignoring non-existent custom folder log spam)
    if ((error as any).code !== 'ENOENT') {
      console.error(`Failed to read templates from ${dirPath}:`, error);
    }
  }
  return templates;
}

export async function getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const builtInDir = path.resolve(__dirname, '../resources/workflows');
  const userDir = path.join(os.homedir(), '.nexusflow', 'workflows');

  // Ensure user custom workflows directory exists so they can find it easily
  try {
    await fs.mkdir(userDir, { recursive: true });
  } catch {}

  const [builtInTemplates, userTemplates] = await Promise.all([
    loadTemplatesFromDir(builtInDir, false),
    loadTemplatesFromDir(userDir, true)
  ]);

  // Merge templates (user custom templates override built-in if they share the same ID)
  const templateMap = new Map<string, WorkflowTemplate>();
  
  for (const t of builtInTemplates) {
    templateMap.set(t.id, t);
  }
  for (const t of userTemplates) {
    templateMap.set(t.id, t);
  }

  return Array.from(templateMap.values());
}

export async function saveWorkflowTemplate(name: string, content: string, originalId?: string): Promise<WorkflowTemplate> {
  const userDir = path.join(os.homedir(), '.nexusflow', 'workflows');
  await fs.mkdir(userDir, { recursive: true });

  // Extract name from the first H1 header (# Name) in content if present
  let parsedName = name;
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('# ')) {
      parsedName = line.trim().substring(2).trim();
      break;
    }
  }

  const id = slugify(parsedName);

  if (!id) {
    throw new Error('Invalid template name');
  }

  // Ensure content starts with "# <Name>" header so it parses correctly next time
  let fileContent = content.trim();
  if (!fileContent.startsWith('# ')) {
    fileContent = `# ${parsedName}\n\n${fileContent}`;
  }

  const filePath = path.join(userDir, `${id}.md`);
  await fs.writeFile(filePath, fileContent, 'utf-8');

  // If we are editing an existing custom template and the ID changed, delete the old file
  if (originalId && originalId !== id) {
    const oldPath = path.join(userDir, `${originalId}.md`);
    try {
      await fs.unlink(oldPath);
    } catch {}
  }

  const parsed = parseMarkdownTemplate(id, fileContent);
  return {
    id,
    custom: true,
    ...parsed,
  };
}

export async function deleteWorkflowTemplate(id: string): Promise<void> {
  const userDir = path.join(os.homedir(), '.nexusflow', 'workflows');
  const filePath = path.join(userDir, `${id}.md`);
  
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as any).code !== 'ENOENT') {
      throw error;
    }
  }
}
