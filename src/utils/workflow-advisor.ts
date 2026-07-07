/**
 * @module utils/workflow-advisor
 * Dynamically suggests task difficulty and teamwork strategy guidelines.
 * Uses the canonical template files from resources/workflows/ as the source
 * of truth, falling back to inline defaults only when templates are unavailable.
 */

import { callLocalLlm } from './local-ai.js';
import { getWorkflowTemplates } from './workflows.js';
import type { LocalLlmConfig, RepoInfo } from '../types.js';

export interface WorkflowSuggestion {
  difficulty: 'simple' | 'moderate' | 'complex';
  rationale: string;
  suggestedWorkflowId: 'solo-developer' | 'research-verify' | 'plan-implement-review';
  customInstructions: string;
}

/**
 * Loads the content of a workflow template by ID. Falls back to a default
 * string if the template file cannot be found.
 */
async function loadTemplateContent(templateId: string, fallback: string): Promise<string> {
  try {
    const templates = await getWorkflowTemplates();
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      return template.content;
    }
  } catch {
    // Silently fall back to inline default
  }
  return fallback;
}

/**
 * Analyzes feature description and repositories to recommend strategy guidelines.
 */
export async function suggestWorkflow(
  description: string,
  repos: RepoInfo[],
  localLlmConfig?: LocalLlmConfig
): Promise<WorkflowSuggestion> {
  const repoNames = repos.map((r) => r.name);
  
  const runHeuristic = async (): Promise<WorkflowSuggestion> => {
    const descLower = (description || '').toLowerCase();
    const isComplexWord = descLower.includes('refactor') ||
                          descLower.includes('migrate') ||
                          descLower.includes('architecture') ||
                          descLower.includes('design') ||
                          descLower.includes('rewrite') ||
                          descLower.includes('optimize') ||
                          descLower.includes('performance') ||
                          descLower.includes('security') ||
                          descLower.includes('database') ||
                          descLower.includes('schema') ||
                          descLower.includes('break') ||
                          descLower.includes('major');
    
    const isSimpleWord = descLower.includes('fix') ||
                         descLower.includes('bug') ||
                         descLower.includes('typo') ||
                         descLower.includes('tweak') ||
                         descLower.includes('color') ||
                         descLower.includes('alignment') ||
                         descLower.includes('comment') ||
                         descLower.includes('readme') ||
                         descLower.includes('test') ||
                         descLower.includes('doc');

    if (repos.length > 2 || isComplexWord) {
      const content = await loadTemplateContent(
        'plan-implement-review',
        `# Team Strategy: Plan, Implement, Review\n\nThis workspace involves complex changes across multiple projects: ${repoNames.join(', ')}.\n\n## Roles & Coordination\n1. **Lead Planner**: Analyzes requirements and details a step-by-step design plan in \`implementation_plan.md\`.\n2. **Code Implementer**: Executes modifications project-by-project following the approved design.\n3. **Code Reviewer**: Runs testing/verification and approves before completion.\n\nPlease follow these roles strictly.`
      );
      return {
        difficulty: 'complex',
        suggestedWorkflowId: 'plan-implement-review',
        rationale: `This task spans multiple repositories or involves architectural components (${repoNames.join(', ')}). A structured Plan-Implement-Review strategy is recommended to coordinate changes carefully.`,
        customInstructions: content,
      };
    } else if (repos.length === 1 && isSimpleWord && !isComplexWord) {
      const content = await loadTemplateContent(
        'solo-developer',
        `# Team Strategy: Solo Developer\n\nThis task is a localized fix in ${repoNames[0] || 'the project'}.\n\n## Guidelines\n- Direct implementation by the main agent.\n- Run tests and compile code immediately.\n- Avoid spawning subagents to reduce overhead.`
      );
      return {
        difficulty: 'simple',
        suggestedWorkflowId: 'solo-developer',
        rationale: `This is a localized fix/tweak within a single repository (${repoNames.join(', ')}). A Solo Developer pattern minimizes overhead and speeds up the modification.`,
        customInstructions: content,
      };
    } else {
      const content = await loadTemplateContent(
        'research-verify',
        `# Team Strategy: Research & Verify\n\nThis task involves moderate changes in ${repoNames.join(', ')}.\n\n## Guidelines\n1. **Research Phase**: Inspect existing components and API interfaces first.\n2. **Implementation Phase**: Write modular code changes.\n3. **Verification Phase**: Confirm build and runs correctly.`
      );
      return {
        difficulty: 'moderate',
        suggestedWorkflowId: 'research-verify',
        rationale: `This is a feature of moderate scope affecting ${repoNames.join(', ')}. We recommend first researching the codebase and dependencies, followed by targeted implementation.`,
        customInstructions: content,
      };
    }
  };

  if (localLlmConfig?.enabled) {
    try {
      const prompt = `You are a software architect analyzing a new feature request.
Feature Description: "${description}"
Target Repositories: ${JSON.stringify(repos.map(r => ({ name: r.name, path: r.path })))}

Determine:
1. Difficulty: "simple", "moderate", or "complex".
2. Suggested Workflow Strategy ID: "solo-developer" (for small tweaks), "research-verify" (for moderate features requiring codebase exploration), or "plan-implement-review" (for complex features spanning multiple repositories/refactorings).
3. A short explanation/rationale.
4. Custom teamwork cooperation guidelines for AGENTS.md, detailing how the agents should coordinate across the selected repositories.

Respond ONLY with a JSON object of this structure:
{
  "difficulty": "simple" | "moderate" | "complex",
  "rationale": "Explanation here",
  "suggestedWorkflowId": "solo-developer" | "research-verify" | "plan-implement-review",
  "customInstructions": "Markdown format teamwork guidelines for AGENTS.md"
}`;

      const responseText = await callLocalLlm(localLlmConfig, [
        { role: 'system', content: 'You are a helpful software architect assistant. Always output valid JSON.' },
        { role: 'user', content: prompt }
      ]);

      const cleanJson = responseText.replace(/```json/i, '').replace(/```/g, '').trim();
      const result = JSON.parse(cleanJson);
      
      if (result.difficulty && result.suggestedWorkflowId && result.customInstructions) {
        return {
          difficulty: result.difficulty,
          rationale: result.rationale || '',
          suggestedWorkflowId: result.suggestedWorkflowId,
          customInstructions: result.customInstructions
        };
      }
    } catch (err) {
      console.warn('Failed to get LLM workflow suggestion, falling back to heuristics:', err);
    }
  }

  return runHeuristic();
}
