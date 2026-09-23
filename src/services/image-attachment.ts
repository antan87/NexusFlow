const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

export class InvalidImageAttachment extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function decodeImageAttachment(dataUrl: string): { buffer: Buffer; extension: string } {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  const extension = match && MIME_EXTENSIONS[match[1]!];
  if (!match || !extension) throw new InvalidImageAttachment('Attach a PNG, JPEG, GIF, or WebP image.');
  if (match[2]!.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new InvalidImageAttachment('Image attachment exceeds the 20MB limit.', 413);
  const buffer = Buffer.from(match[2]!, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new InvalidImageAttachment('Image attachment is empty or exceeds the 20MB limit.', buffer.length > MAX_IMAGE_BYTES ? 413 : 400);
  if (buffer.toString('base64') !== match[2]) throw new InvalidImageAttachment('Image attachment contains invalid base64.');
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!(extension === 'png' && isPng || extension === 'jpg' && isJpeg || extension === 'gif' && isGif || extension === 'webp' && isWebp)) {
    throw new InvalidImageAttachment('Image bytes do not match the declared format.');
  }
  return { buffer, extension };
}
