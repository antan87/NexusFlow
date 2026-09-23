import { describe, expect, it } from 'vitest';
import { decodeImageAttachment } from './image-attachment.js';

const url = (type: string, bytes: number[]) => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
describe('image attachment decoding', () => {
  it('accepts a PNG signature and assigns a fixed extension', () => {
    expect(decodeImageAttachment(url('png', [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])).extension).toBe('png');
  });
  it('rejects HTML disguised as an image, unsupported SVG, and malformed base64', () => {
    expect(() => decodeImageAttachment(url('png', [...Buffer.from('<script>')]))).toThrow('do not match');
    expect(() => decodeImageAttachment(url('svg+xml', [...Buffer.from('<svg/>')]))).toThrow('PNG, JPEG, GIF, or WebP');
    expect(() => decodeImageAttachment('data:image/png;base64,not_base64')).toThrow('PNG, JPEG, GIF, or WebP');
  });
  it('rejects an oversized image before decoding it', () => {
    expect(() => decodeImageAttachment(`data:image/png;base64,${'A'.repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4)}`)).toThrow('20MB');
  });
});
