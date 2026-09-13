/**
 * @module core/domain-packs
 * Enterprise domain packs and organization conventions engine.
 * Solves enterprise context bloat by isolating subsystem rules (Economy, HR, etc.)
 * while universally enforcing company root conventions (commit format, PR rules).
 */

import type { DomainPack, OrganizationConventions, ResolvedCategoryRules } from '../types.js';
import { readDomainCatalog, mutateDomainCatalog } from './domain-catalog.js';
export type { ResolvedCategoryRules };

/** Built-in enterprise organization conventions (clean slate by default; generic solution). */
export const BUILTIN_ORGANIZATIONS: OrganizationConventions[] = [];

/** Built-in enterprise domain pack starter templates (clean slate by default; generic solution). */
export const BUILTIN_DOMAIN_PACKS: DomainPack[] = [];

/**
 * Optional sample organization conventions for tests, documentation, or manual seeding.
 * Never loaded by default so NexusFlow remains 100% generic.
 */
export const SAMPLE_ORGANIZATIONS: OrganizationConventions[] = [
  {
    id: 'acme',
    name: 'Acme Corp',
    commitMessagePattern: '^(feat|fix|refactor|test|chore|docs|style|perf|build|ci)\\([A-Za-z0-9_.-]+\\): .+$',
    commitExample: 'feat(ECO-412): add reverse charge calculation',
    prTemplate: '.github/pull_request_template.md',
    rules: [
      'All commit messages should follow conventional commits with a subsystem or ticket scope, e.g. feat(ECO-123): description.',
      'Always ensure mechanical verification gate passes cleanly before proposing a PR.',
      'Keep code changes focused on the task and maintain backwards compatibility across shared interfaces.',
      'Never commit sensitive credentials, API keys, or raw personal data (GDPR).',
    ],
  },
];

/**
 * Optional sample domain packs for tests, documentation, or manual seeding.
 * Never loaded by default so NexusFlow remains 100% generic.
 */
export const SAMPLE_DOMAIN_PACKS: DomainPack[] = [
  {
    id: 'economy',
    name: 'Economy & Invoicing',
    description: 'Accounting rules, Swedish VAT/tax compliance, invoice schemas, and ledger APIs.',
    organization: 'acme',
    categoryType: 'vertical',
    isTemplate: true,
    tags: [
      'economy',
      'invoicing',
      'invoice',
      'vat',
      'tax',
      'accounting',
      'ledger',
      'skatteverket',
      'moms',
      'billing',
      'finance',
      'payment',
      'receipt',
      'faktura',
    ],
    rules: [
      'Swedish VAT standard rates are 25% (standard), 12% (food/hospitality), 6% (culture/books), and 0% / reverse charge for export.',
      'Financial calculations must use integer cents/öre or dedicated precision libraries to avoid floating-point rounding errors.',
      'All ledger mutation operations must produce an immutable, audit-trail compliant event.',
      'Invoice identifiers and sequence counters must be strictly monotonic and gap-free.',
    ],
    verifyCommand: 'npm test -- economy',
  },
  {
    id: 'hr',
    name: 'HR & Workforce',
    description: 'Employee records, workforce agreements, and personnel management.',
    organization: 'acme',
    categoryType: 'vertical',
    isTemplate: true,
    tags: [
      'hr',
      'personnel',
      'employee',
      'personal',
      'employment',
      'workforce',
    ],
    rules: [
      'Employee record modifications require explicit authorization checks and audit logging.',
    ],
    verifyCommand: 'npm test -- hr',
  },
  {
    id: 'hr/payroll',
    name: 'Payroll & Salaries',
    description: 'Payroll formulas, collective agreements, and social security deductions.',
    parent: 'hr',
    organization: 'acme',
    categoryType: 'vertical',
    isTemplate: true,
    tags: [
      'payroll',
      'salary',
      'lön',
      'benefits',
      'kollektivavtal',
      'arbetsgivaravgifter',
    ],
    rules: [
      'Payroll calculations must adhere to Swedish collective agreements (kollektivavtal) and statutory social security deductions (arbetsgivaravgifter).',
    ],
    verifyCommand: 'npm test -- payroll',
    microservices: [
      { name: 'payroll-engine', target: 'edit', description: 'Core salary calculation engine' },
    ],
  },
  {
    id: 'transport',
    name: 'Transport & Logistics',
    description: 'Route planning, fleet dispatch, vehicle telemetry, and shipping carrier integrations.',
    organization: 'acme',
    categoryType: 'vertical',
    isTemplate: true,
    tags: [
      'transport',
      'logistics',
      'fleet',
      'dispatch',
      'routing',
      'carrier',
      'shipping',
      'freight',
      'telemetry',
      'gps',
      'åkeri',
      'leverans',
    ],
    rules: [
      'Vehicle telemetry and dispatch timestamps must always be handled and stored in UTC.',
      'External carrier API integrations must include idempotency keys and exponential backoff retries.',
      'Driver working hour regulations (körkorts- och vilotider) must be enforced on route assignment algorithms.',
    ],
    verifyCommand: 'npm test -- transport',
  },
  {
    id: 'gdpr',
    name: 'GDPR & Privacy Guard',
    description: 'Cross-cutting personal identity number masking and privacy compliance.',
    categoryType: 'trait',
    isTemplate: true,
    tags: [
      'gdpr',
      'privacy',
      'personnummer',
      'anonymize',
      'ssn',
      'pii',
    ],
    rules: [
      'GDPR Compliance: Personal identity numbers (personnummer) and salary figures must NEVER be logged in plain text.',
      'All citizen data export operations must support right-to-be-forgotten privacy requests.',
    ],
  },
];

/** Process-local overrides for programmatic integrations and sample fixtures. */
const customOrganizations = new Map<string, OrganizationConventions>();

/** Process-local overrides for programmatic integrations and sample fixtures. */
const customDomainPacks = new Map<string, DomainPack>();

/**
 * Registers a user-defined custom organization conventions profile.
 */
export function registerCustomOrganization(org: OrganizationConventions): void {
  const normalized = org.id.toLowerCase().trim();
  customOrganizations.set(normalized, { ...org, id: normalized, isTemplate: false });
}

/**
 * Unregisters a user-defined custom organization.
 */
export function unregisterCustomOrganization(id: string): boolean {
  return customOrganizations.delete(id.toLowerCase().trim());
}

/**
 * Registers a user-defined custom domain pack.
 */
export function registerCustomDomainPack(pack: DomainPack): void {
  const normalized = pack.id.toLowerCase().trim();
  customDomainPacks.set(normalized, { ...pack, id: normalized, isTemplate: false });
}

/**
 * Unregisters a user-defined custom domain pack.
 */
export function unregisterCustomDomainPack(id: string): boolean {
  return customDomainPacks.delete(id.toLowerCase().trim());
}

/**
 * Clears all registered custom organizations and domain packs (useful for tests).
 */
export function clearCustomDomainRegistrations(): void {
  customOrganizations.clear();
  customDomainPacks.clear();
}

/** Durable administration used by the GUI; runtime fixtures are never implicitly persisted. */
export async function saveDomainPack(pack: DomainPack): Promise<void> {
  const normalized = { ...pack, id: pack.id.toLowerCase().trim(), isTemplate: false };
  await mutateDomainCatalog((catalog) => {
    catalog.domainPacks = catalog.domainPacks.filter((p) => p.id !== normalized.id);
    catalog.domainPacks.push(normalized);
  });
}

export async function saveOrganization(org: OrganizationConventions): Promise<void> {
  const normalized = { ...org, id: org.id.toLowerCase().trim(), isTemplate: false };
  await mutateDomainCatalog((catalog) => {
    catalog.organizations = catalog.organizations.filter((o) => o.id !== normalized.id);
    catalog.organizations.push(normalized);
  });
}

export async function deleteDomainPack(id: string): Promise<boolean> {
  const normalized = id.toLowerCase().trim();
  const deleted = await mutateDomainCatalog((catalog) => {
    const exists = catalog.domainPacks.some((p) => p.id === normalized);
    catalog.domainPacks = catalog.domainPacks.filter((p) => p.id !== normalized);
    return exists;
  });
  return unregisterCustomDomainPack(normalized) || deleted;
}

export async function deleteOrganization(id: string): Promise<boolean> {
  const normalized = id.toLowerCase().trim();
  const deleted = await mutateDomainCatalog((catalog) => {
    const exists = catalog.organizations.some((o) => o.id === normalized);
    catalog.organizations = catalog.organizations.filter((o) => o.id !== normalized);
    return exists;
  });
  return unregisterCustomOrganization(normalized) || deleted;
}

/**
 * Helper to seed sample domain packs and organizations (useful for tests or documentation).
 */
export function registerSampleDomainPacks(): void {
  for (const org of SAMPLE_ORGANIZATIONS) {
    registerCustomOrganization(org);
  }
  for (const pack of SAMPLE_DOMAIN_PACKS) {
    registerCustomDomainPack(pack);
  }
}

/**
 * Returns all available organization conventions (built-in sample templates + user-defined).
 */
export function getAvailableOrganizations(): OrganizationConventions[] {
  const map = new Map<string, OrganizationConventions>();
  for (const org of BUILTIN_ORGANIZATIONS) {
    map.set(org.id.toLowerCase().trim(), { ...org, isTemplate: true });
  }
  for (const [id, org] of customOrganizations) {
    map.set(id, org);
  }
  for (const org of readDomainCatalog().organizations) map.set(org.id, org);
  return Array.from(map.values());
}

/**
 * Resolves an organization by its ID.
 */
export function getOrganization(id?: string): OrganizationConventions | null {
  if (!id) return null;
  const normalized = id.toLowerCase().trim();
  return getAvailableOrganizations().find((o) => o.id === normalized) ?? null;
}

/**
 * Returns all available domain packs (built-in sample templates + user-defined).
 */
export function getAvailableDomainPacks(): DomainPack[] {
  const builtinIds = new Set(BUILTIN_DOMAIN_PACKS.map((p) => p.id.toLowerCase().trim()));
  const map = new Map<string, DomainPack>();
  for (const pack of BUILTIN_DOMAIN_PACKS) {
    map.set(pack.id.toLowerCase().trim(), { ...pack, isTemplate: true, builtin: true });
  }
  for (const [id, pack] of customDomainPacks) {
    map.set(id, { ...pack, builtin: builtinIds.has(id) });
  }
  for (const pack of readDomainCatalog().domainPacks) {
    map.set(pack.id, { ...pack, builtin: builtinIds.has(pack.id) });
  }
  return Array.from(map.values());
}

/**
 * Resolves a domain pack by its ID.
 */
export function getDomainPack(id: string): DomainPack | null {
  const normalized = id.toLowerCase().trim();
  return getAvailableDomainPacks().find((p) => p.id === normalized) ?? null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWord(text: string, term: string): boolean {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return false;
  const escaped = escapeRegExp(trimmed);
  const pattern = new RegExp(`(^|[^a-zA-Z0-9_#+])${escaped}([^a-zA-Z0-9_#+]|$)`, 'i');
  return pattern.test(text);
}

/**
 * Analyzes word occurrences against all available domain pack tags and descriptions.
 *
 * @param description - Feature description, user story, or Product Owner spec.
 * @param repoNames   - Optional list of repository names to consider.
 * @returns Ranked list of matched DomainPacks.
 */
export function matchDomainPacks(description: string, repoNames: string[] = []): DomainPack[] {
  const text = `${description} ${repoNames.join(' ')}`.toLowerCase();
  if (!text.trim()) return [];

  const matched: Array<{ pack: DomainPack; score: number }> = [];

  for (const pack of getAvailableDomainPacks()) {
    let score = 0;

    // Check direct ID or Name occurrence with word-boundary awareness
    if (matchesWord(text, pack.id)) score += 5;
    if (matchesWord(text, pack.name)) score += 5;

    // Check tag occurrences (word-boundary and special characters aware)
    for (const tag of pack.tags) {
      if (matchesWord(text, tag)) {
        score += 3;
      }
    }

    if (score > 0) {
      matched.push({ pack, score });
    }
  }

  // Sort descending by match score
  return matched.sort((a, b) => b.score - a.score).map((m) => m.pack);
}



/**
 * Resolves the aggregated rules, inheritance hierarchy, traits, and composable verification commands
 * for an organization and active category / tag packs.
 */
export function resolveActiveDomainRules(
  organizationId?: string,
  domainPackIds: string[] = [],
): ResolvedCategoryRules {
  const organization = getOrganization(organizationId);

  // 1. Resolve full pack set including parents (tree hierarchy walk)
  const resolvedPacksMap = new Map<string, DomainPack>();
  const isDirectlyAssigned = new Set(domainPackIds.map((id) => id.toLowerCase().trim()));

  for (const packId of domainPackIds) {
    let current = getDomainPack(packId);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id.toLowerCase())) {
        break; // Guard against circular parent references
      }
      visited.add(current.id.toLowerCase());

      if (!resolvedPacksMap.has(current.id)) {
        resolvedPacksMap.set(current.id, current);
      }
      if (current.parent) {
        current = getDomainPack(current.parent);
      } else {
        break;
      }
    }
  }

  const domainPacks = Array.from(resolvedPacksMap.values());
  const verticals: DomainPack[] = [];
  const traits: DomainPack[] = [];

  for (const pack of domainPacks) {
    if (pack.categoryType === 'trait') {
      traits.push(pack);
    } else {
      verticals.push(pack);
    }
  }

  // 2. Specificity Ordering:
  // Level 0: Organization root conventions (base)
  // Level 1: Parent categories (more general)
  // Level 2: Child categories (more specific)
  // Level 3: Horizontal traits (cross-cutting policies)
  const ruleBuckets: { [level: number]: string[] } = { 0: [], 1: [], 2: [], 3: [] };

  if (organization) {
    ruleBuckets[0].push(...organization.rules);
  }

  for (const pack of verticals) {
    if (!pack.rules) continue;
    const level = pack.parent || isDirectlyAssigned.has(pack.id) ? 2 : 1;
    ruleBuckets[level].push(...pack.rules);
  }

  for (const trait of traits) {
    if (trait.rules) {
      ruleBuckets[3].push(...trait.rules);
    }
  }

  // 3. Assemble and deduplicate rules in specificity order
  const allRules: string[] = [];
  const seenRules = new Set<string>();

  for (const level of [0, 1, 2, 3]) {
    for (const rule of ruleBuckets[level]) {
      const normalized = rule.trim();
      if (!seenRules.has(normalized)) {
        seenRules.add(normalized);
        allRules.push(rule);
      }
    }
  }

  // 4. Composable Mechanical Verification Gates
  const verifyCommands = new Set<string>();
  for (const pack of domainPacks) {
    if (pack.verifyCommand && pack.verifyCommand.trim()) {
      verifyCommands.add(pack.verifyCommand.trim());
    }
  }
  const compositeVerifyCommand = verifyCommands.size > 0
    ? Array.from(verifyCommands).join(' && ')
    : undefined;

  // 5. Aggregate Microservice Repos (Edit vs Reference)
  const editReposSet = new Set<string>();
  const referenceReposSet = new Set<string>();

  for (const pack of domainPacks) {
    if (pack.defaultRepos) {
      for (const r of pack.defaultRepos) {
        editReposSet.add(r);
      }
    }
    if (pack.microservices) {
      for (const ms of pack.microservices) {
        if (ms.target === 'reference') {
          referenceReposSet.add(ms.name);
        } else {
          editReposSet.add(ms.name);
        }
      }
    }
  }

  return {
    organization,
    domainPacks,
    verticals,
    traits,
    allRules,
    compositeVerifyCommand,
    editRepos: Array.from(editReposSet),
    referenceRepos: Array.from(referenceReposSet),
  };
}
