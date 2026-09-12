/**
 * @module utils/workflow-advisor
 * Dynamically suggests task difficulty and teamwork strategy guidelines.
 * Uses the canonical template files from resources/workflows/ as the source
 * of truth, falling back to inline defaults only when templates are unavailable.
 */

import { getWorkflowTemplates } from './workflows.js';
import type { RepoInfo } from '../types.js';

export interface WorkflowSuggestion {
  difficulty: 'simple' | 'moderate' | 'complex';
  rationale: string;
  suggestedWorkflowId: 'solo-developer' | 'research-verify' | 'plan-implement-review' | 'epic-multi-slice';
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
  repos: RepoInfo[]
): Promise<WorkflowSuggestion> {
  const repoNames = repos.map((r) => r.name);
  
  // Whole words, not substrings. `includes('fix')` matched "prefix" and
  // "suffix", and `includes('design')` matched "the design doc" — so "Add a
  // prefix to the docker tag" was classified as a simple task by accident.
  const words = new Set((description || '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const mentions = (...candidates: string[]) => candidates.some((word) => words.has(word));

  const isEpicWord = mentions(
    'epic', 'multi-pr', 'multipr', 'multi-branch', 'multibranch',
    'stacked', 'sub-branch', 'subbranch', 'slices', 'slice', 'milestone', 'milestones',
  );

  const isComplexWord = mentions(
    'refactor', 'refactoring', 'migrate', 'migration', 'architecture', 'architectural',
    'rewrite', 'optimize', 'optimise', 'performance', 'security', 'database',
    'schema', 'breaking', 'major',
  );

  const isSimpleWord = mentions(
    'fix', 'bug', 'typo', 'tweak', 'color', 'colour', 'alignment',
    'comment', 'readme', 'doc', 'docs', 'rename', 'wording',
  );

  // Epic / multi-PR / multi-branch workflow detection
  if (isEpicWord && !isSimpleWord) {
    const where = repoNames.length === 1 ? repoNames[0]! : repoNames.join(', ') || 'the project';
    const content = await loadTemplateContent(
      'epic-multi-slice',
      `# Team Strategy: Epic & Multi-PR Slices\n\nThis workspace coordinates a large feature, multi-PR module, or epic across ${where}.\n\n## Guidelines & Lifecycle\n1. **Vertical Slice Decomposition**: Do not attempt to deliver the entire epic in a single monolithic branch or PR. Decompose into atomic, reviewable slices.\n2. **Independent Reviewability**: Every slice must build cleanly and pass its test gate (\`verify\` command) independently.\n3. **Cumulative Knowledge & Contracts**: Record architectural decisions and cross-slice contracts in contextspace-knowledge.md.\n4. **Milestone Handoffs**: Complete and verify each slice before advancing to the next.`
    );
    return {
      difficulty: 'complex',
      suggestedWorkflowId: 'epic-multi-slice',
      rationale: `This task involves an epic, multi-PR, or multi-branch flow across ${where}. An Epic & Multi-PR Slices strategy is recommended to deliver changes in reviewable, incremental batches.`,
      customInstructions: content,
    };
  // Repo count no longer overrides an explicit signal. Coordinating several
  // repos is real work, but a typo across three repos is still a typo — and the
  // old \`repos.length > 2 ||\` sent it to the heaviest tier.
  } else if (isComplexWord || (repos.length > 2 && !isSimpleWord)) {
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
    // A localized change stays localized whether it touches one repo or several,
    // so this no longer requires `repos.length === 1`.
  } else if (isSimpleWord) {
    const where = repoNames.length === 1 ? repoNames[0]! : repoNames.join(', ') || 'the project';
    const content = await loadTemplateContent(
      'solo-developer',
      `# Team Strategy: Solo Developer\n\nThis task is a localized fix in ${where}.\n\n## Guidelines\n- Direct implementation by the main agent.\n- Run tests and compile code immediately.\n- Avoid spawning subagents to reduce overhead.`
    );
    return {
      difficulty: 'simple',
      suggestedWorkflowId: 'solo-developer',
      rationale: `This is a localized fix/tweak in ${where}. A Solo Developer pattern minimizes overhead and speeds up the modification.`,
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
}
