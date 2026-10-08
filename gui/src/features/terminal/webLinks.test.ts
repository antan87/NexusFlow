import { describe, expect, it } from 'vitest';
import { findWebLinks, isWebOrDomain, normalizeWebUrl } from './webLinks.js';

describe('webLinks', () => {
  it('finds URLs with schemes and wrapped in angle brackets', () => {
    const found = findWebLinks('see https://example.com/file and <https://github.com/foo> plus http://localhost:3000/api');
    expect(found.map(f => ({ text: f.text, url: f.url }))).toEqual([
      { text: 'https://example.com/file', url: 'https://example.com/file' },
      { text: 'https://github.com/foo', url: 'https://github.com/foo' },
      { text: 'http://localhost:3000/api', url: 'http://localhost:3000/api' },
    ]);
  });

  it('finds bare domains, mailto, and localhost with ports', () => {
    const found = findWebLinks('contact mailto:test@example.com or user@example.com visit github.com/foo or localhost:8080');
    expect(found.map(f => ({ text: f.text, url: f.url }))).toEqual([
      { text: 'mailto:test@example.com', url: 'mailto:test@example.com' },
      { text: 'user@example.com', url: 'mailto:user@example.com' },
      { text: 'github.com/foo', url: 'http://github.com/foo' },
      { text: 'localhost:8080', url: 'http://localhost:8080' },
    ]);
  });

  it('does not classify repository files as web links', () => {
    const found = findWebLinks('src/app.ts:12 README.md deploy.sh components/Button.tsx package.json');
    expect(found).toEqual([]);
  });

  it('detects web schemes and domains via isWebOrDomain', () => {
    expect(isWebOrDomain('https://example.com')).toBe(true);
    expect(isWebOrDomain('http://localhost:3000')).toBe(true);
    expect(isWebOrDomain('<https://example.com>')).toBe(true);
    expect(isWebOrDomain('mailto:test@example.com')).toBe(true);
    expect(isWebOrDomain('github.com/foo/bar')).toBe(true);
    expect(isWebOrDomain('example.com:8080')).toBe(true);
    expect(isWebOrDomain('localhost:3000')).toBe(true);
    expect(isWebOrDomain('127.0.0.1:8080')).toBe(true);
    expect(isWebOrDomain('www.google.com/maps')).toBe(true);

    expect(isWebOrDomain('src/app.ts')).toBe(false);
    expect(isWebOrDomain('src/index.test.ts')).toBe(false);
    expect(isWebOrDomain('index.test.ts')).toBe(false);
    expect(isWebOrDomain('app.spec.tsx')).toBe(false);
    expect(isWebOrDomain('vite.config.ts')).toBe(false);
    expect(isWebOrDomain('README.md')).toBe(false);
    expect(isWebOrDomain('README.md#getting-started')).toBe(false);
    expect(isWebOrDomain('file.ts#L42')).toBe(false);
    expect(isWebOrDomain('deploy.sh')).toBe(false);
    expect(isWebOrDomain('package.json')).toBe(false);
    expect(isWebOrDomain('build.log')).toBe(false);
    expect(isWebOrDomain('nginx.conf')).toBe(false);
    expect(isWebOrDomain('data.csv')).toBe(false);
    expect(isWebOrDomain('Main.kt')).toBe(false);
    expect(isWebOrDomain('app.swift')).toBe(false);
    expect(isWebOrDomain('schema.graphql')).toBe(false);
    expect(isWebOrDomain('main.rs')).toBe(false);
    expect(isWebOrDomain('file:///home/user/workspace/app.ts')).toBe(false);
  });

  it('treats wrapped URLs, mail links, bare domains and local servers as web addresses', () => {
    for (const url of ['https://github.com/mrpatronz/nexusflow', 'http://localhost:3000/api', '<https://example.com/docs>', '<http://127.0.0.1:8080>',
      'mailto:team@example.com', '<mailto:user@example.com>', 'github.com/foo/bar', 'example.com:8080', 'localhost:3000', '127.0.0.1:3000/test', 'www.google.com/search']) {
      expect(isWebOrDomain(url)).toBe(true);
      expect(normalizeWebUrl(url)).toMatch(/^(?:https?:\/\/|mailto:)/);
    }
  });

  it('normalizes web URLs with appropriate protocols', () => {
    expect(normalizeWebUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeWebUrl('<https://example.com>')).toBe('https://example.com');
    expect(normalizeWebUrl('<http://localhost:3000>')).toBe('http://localhost:3000');
    expect(normalizeWebUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(normalizeWebUrl('github.com/foo')).toBe('https://github.com/foo');
    expect(normalizeWebUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeWebUrl('127.0.0.1:5000')).toBe('http://127.0.0.1:5000');
    expect(normalizeWebUrl('//example.com/cdn')).toBe('https://example.com/cdn');
  });

});
