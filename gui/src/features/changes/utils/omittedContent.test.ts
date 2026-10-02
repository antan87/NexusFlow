import { describe, expect, it } from 'vitest';
import { omittedNotice } from './omittedContent.js';

describe('omittedNotice', () => {
  it('says nothing when everything was loaded', () => {
    expect(omittedNotice(undefined)).toBeNull();
    expect(omittedNotice({})).toBeNull();
  });

  it('explains a binary file without promising a text view', () => {
    expect(omittedNotice({ content: 'binary' })).toMatch(/binary/i);
  });

  it('explains that an oversized file is shown as its changed lines only', () => {
    const notice = omittedNotice({ content: 'too-large' });
    expect(notice).toMatch(/too large/i);
    expect(notice).toMatch(/changed lines/i);
  });

  it('says the diff itself is not shown when it was too large, and points to the editor', () => {
    const notice = omittedNotice({ content: 'too-large', diff: true });
    expect(notice).toMatch(/diff is too large/i);
    expect(notice).toMatch(/editor/i);
  });
});
