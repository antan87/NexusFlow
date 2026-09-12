import { describe, it, expect } from 'vitest';
import {
  getAvailableOrganizations,
  getOrganization,
  getAvailableDomainPacks,
  getDomainPack,
  matchDomainPacks,
  resolveActiveDomainRules,
  registerCustomOrganization,
  unregisterCustomOrganization,
  registerCustomDomainPack,
  unregisterCustomDomainPack,
} from './domain-packs.js';

describe('domain-packs', () => {
  describe('organizations', () => {
    it('returns built-in organizations', () => {
      const orgs = getAvailableOrganizations();
      expect(orgs.length).toBeGreaterThan(0);
      expect(orgs.some((o) => o.id === 'hogia')).toBe(true);
    });

    it('retrieves organization by id case-insensitively', () => {
      const hogia = getOrganization('HOGIA');
      expect(hogia).not.toBeNull();
      expect(hogia?.name).toBe('Hogia');
      expect(hogia?.commitMessagePattern).toBeDefined();
      expect(hogia?.rules.length).toBeGreaterThan(0);
    });

    it('returns null for unknown organization', () => {
      expect(getOrganization('non-existent-corp')).toBeNull();
      expect(getOrganization(undefined)).toBeNull();
    });
  });

  describe('domain packs', () => {
    it('returns built-in domain packs', () => {
      const packs = getAvailableDomainPacks();
      expect(packs.length).toBeGreaterThanOrEqual(3);
      const ids = packs.map((p) => p.id);
      expect(ids).toContain('economy');
      expect(ids).toContain('hr');
      expect(ids).toContain('transport');
    });

    it('retrieves domain pack by id', () => {
      const economy = getDomainPack('economy');
      expect(economy).not.toBeNull();
      expect(economy?.name).toContain('Economy');
      expect(economy?.tags).toContain('vat');
      expect(economy?.rules?.some((r) => r.includes('VAT standard rates'))).toBe(true);
    });

    it('returns null for unknown domain pack', () => {
      expect(getDomainPack('crypto')).toBeNull();
    });
  });

  describe('matchDomainPacks', () => {
    it('matches economy domain pack from invoice and VAT keywords', () => {
      const matched = matchDomainPacks('Fix reverse charge VAT on invoice export');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].id).toBe('economy');
    });

    it('matches specific hr/payroll subcategory from payroll and collective agreement keywords', () => {
      const matched = matchDomainPacks('Calculate employee payroll deductions according to kollektivavtal');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].id).toBe('hr/payroll');
    });

    it('matches hr workforce pack from employee personnel profile query', () => {
      const matched = matchDomainPacks('Onboard new employee and update personnel workforce profile');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].id).toBe('hr');
    });

    it('matches transport domain pack from route dispatch telemetry', () => {
      const matched = matchDomainPacks('Optimize dispatch routing and carrier telemetry');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].id).toBe('transport');
    });

    it('matches multiple domains when keywords span subsystems', () => {
      const matched = matchDomainPacks('Sync employee salary deductions with economy invoicing ledger');
      const matchedIds = matched.map((m) => m.id);
      expect(matchedIds).toContain('economy');
      expect(matchedIds).toContain('hr');
    });

    it('returns empty array when no keywords match', () => {
      const matched = matchDomainPacks('Fix styling of navbar footer button');
      expect(matched).toEqual([]);
    });

    it('handles empty input gracefully', () => {
      expect(matchDomainPacks('')).toEqual([]);
      expect(matchDomainPacks('   ')).toEqual([]);
    });
  });

  describe('resolveActiveDomainRules', () => {
    it('aggregates universal company rules and scoped domain rules', () => {
      const resolved = resolveActiveDomainRules('hogia', ['economy']);
      expect(resolved.organization?.id).toBe('hogia');
      expect(resolved.domainPacks.map((p) => p.id)).toEqual(['economy']);

      // Universal Hogia conventions
      expect(resolved.allRules.some((r) => r.includes('conventional commits'))).toBe(true);
      expect(resolved.allRules.some((r) => r.includes('mechanical verification gate'))).toBe(true);

      // Economy subsystem rules
      expect(resolved.allRules.some((r) => r.includes('Swedish VAT standard rates'))).toBe(true);
      expect(resolved.allRules.some((r) => r.includes('integer cents/öre'))).toBe(true);

      // Does NOT leak HR or transport rules
      expect(resolved.allRules.some((r) => r.includes('personnummer'))).toBe(false);
      expect(resolved.allRules.some((r) => r.includes('Vehicle telemetry'))).toBe(false);
    });

    it('handles missing organization and domain packs', () => {
      const resolved = resolveActiveDomainRules(undefined, []);
      expect(resolved.organization).toBeNull();
      expect(resolved.domainPacks).toEqual([]);
      expect(resolved.allRules).toEqual([]);
      expect(resolved.compositeVerifyCommand).toBeUndefined();
    });

    it('inherits parent category rules automatically when child is active', () => {
      // hr/payroll has parent: 'hr'
      const resolved = resolveActiveDomainRules('hogia', ['hr/payroll']);
      const packIds = resolved.domainPacks.map((p) => p.id);
      expect(packIds).toContain('hr/payroll');
      expect(packIds).toContain('hr'); // Parent inherited!

      // Has hr parent rule
      expect(resolved.allRules.some((r) => r.includes('Employee record modifications require explicit authorization'))).toBe(true);
      // Has hr/payroll child rule
      expect(resolved.allRules.some((r) => r.includes('collective agreements (kollektivavtal)'))).toBe(true);

      // Distinguishes edit microservice
      expect(resolved.editRepos).toContain('payroll-engine');
    });

    it('composes horizontal traits and aggregates composable verification gates', () => {
      // Vertical: economy, Trait: gdpr
      const resolved = resolveActiveDomainRules('hogia', ['economy', 'gdpr']);
      expect(resolved.verticals.map((v) => v.id)).toContain('economy');
      expect(resolved.traits.map((t) => t.id)).toContain('gdpr');

      // Has economy rule
      expect(resolved.allRules.some((r) => r.includes('Swedish VAT standard rates'))).toBe(true);
      // Has gdpr trait rule
      expect(resolved.allRules.some((r) => r.includes('Personal identity numbers (personnummer) and salary figures must NEVER be logged'))).toBe(true);

      // Composable verification gate
      expect(resolved.compositeVerifyCommand).toBe('npm test -- economy');
    });
  });

  describe('custom organizations and domain packs', () => {
    it('registers and unregisters custom organizations', () => {
      registerCustomOrganization({
        id: 'acme-corp',
        name: 'Acme Corporation',
        commitMessagePattern: '^(feat|fix): ACM-[0-9]+ .+$',
        commitExample: 'feat: ACM-101 add laser gadget',
        rules: ['All code changes must have 100% test coverage.', 'Safety checks required.'],
      });

      const org = getOrganization('acme-corp');
      expect(org).not.toBeNull();
      expect(org?.name).toBe('Acme Corporation');
      expect(org?.isTemplate).toBe(false);

      expect(getAvailableOrganizations().some((o) => o.id === 'acme-corp')).toBe(true);

      const deleted = unregisterCustomOrganization('acme-corp');
      expect(deleted).toBe(true);
      expect(getOrganization('acme-corp')).toBeNull();
    });

    it('registers, matches, and unregisters custom domain packs', () => {
      registerCustomDomainPack({
        id: 'gaming-physics',
        name: 'Game Physics & Collision',
        description: 'Rigid body dynamics, collision detection, and spatial partitioning.',
        tags: ['physics', 'collision', 'rigidbody', 'gravity'],
        rules: ['Physics ticks must execute at deterministic 60Hz.', 'Allocations inside tick loops forbidden.'],
        verifyCommand: 'npm run test:physics',
      });

      const pack = getDomainPack('gaming-physics');
      expect(pack).not.toBeNull();
      expect(pack?.name).toBe('Game Physics & Collision');
      expect(pack?.isTemplate).toBe(false);

      // Auto-match against custom domain tags
      const matched = matchDomainPacks('Fix collision detection in rigidbody gravity system');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].id).toBe('gaming-physics');

      const deleted = unregisterCustomDomainPack('gaming-physics');
      expect(deleted).toBe(true);
      expect(getDomainPack('gaming-physics')).toBeNull();
    });

    it('prevents false-positive substring matching (e.g. thread should not match hr)', () => {
      const threadMatches = matchDomainPacks('Fix thread synchronization issue in background worker');
      const matchedIds = threadMatches.map((p) => p.id);
      expect(matchedIds).not.toContain('hr');

      const hrMatches = matchDomainPacks('Update hr records and employee contracts');
      const hrMatchedIds = hrMatches.map((p) => p.id);
      expect(hrMatchedIds).toContain('hr');
    });

    it('safely matches tags containing special regex metacharacters without throwing', () => {
      registerCustomDomainPack({
        id: 'cpp-module',
        name: 'C++ Native Module',
        description: 'Native addons and bindings.',
        tags: ['c++', 'c#', 'web+worker', '[native]'],
        rules: [],
      });

      expect(() => {
        const matches = matchDomainPacks('Upgrade c++ bindings for native worker');
        expect(matches.some((m) => m.id === 'cpp-module')).toBe(true);
      }).not.toThrow();

      unregisterCustomDomainPack('cpp-module');
    });

    it('prevents infinite loops on circular parent hierarchies', () => {
      registerCustomDomainPack({
        id: 'cycle-a',
        name: 'Cycle A',
        description: 'Cyclic test A',
        parent: 'cycle-b',
        tags: ['cycle'],
        rules: ['Rule A'],
      });
      registerCustomDomainPack({
        id: 'cycle-b',
        name: 'Cycle B',
        description: 'Cyclic test B',
        parent: 'cycle-a',
        tags: ['cycle'],
        rules: ['Rule B'],
      });

      expect(() => {
        const resolved = resolveActiveDomainRules(undefined, ['cycle-a']);
        expect(resolved.domainPacks.length).toBe(2);
      }).not.toThrow();

      unregisterCustomDomainPack('cycle-a');
      unregisterCustomDomainPack('cycle-b');
    });
  });
});

