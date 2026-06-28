import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

export async function getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  // Resolve workflows path relative to dist/ folder
  const workflowsDir = path.resolve(__dirname, '../resources/workflows');
  const templates: WorkflowTemplate[] = [];

  try {
    const files = await fs.readdir(workflowsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = path.basename(file, '.md');
      const content = await fs.readFile(path.join(workflowsDir, file), 'utf-8');
      
      // Derive name and description from filename or content
      let name = id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      if (id === 'plan-implement-review') name = 'Plan-Implement-Review Loop';
      
      let description = '';
      if (id === 'plan-implement-review') {
        description = 'Lead planner designs, Code Implementer subagent writes edits, and Code Reviewer subagent tests & reviews in a loop.';
      } else if (id === 'research-verify') {
        description = 'Research specialist subagent analyzes codebase, followed by test-driven developer subagent implementation.';
      } else if (id === 'solo-developer') {
        description = 'Direct coding and verification by the primary agent without subagent delegation overhead.';
      }

      templates.push({
        id,
        name,
        description,
        content
      });
    }
  } catch (error) {
    console.error('Failed to read workflow templates:', error);
  }

  return templates;
}
