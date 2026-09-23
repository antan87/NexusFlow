/**
 * @module lib/clipboard
 * Cross-browser safe clipboard helper with textarea fallback for non-secure contexts.
 */
import { decodeHTML } from 'entities/decode';

export async function safeCopyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Clipboard permissions are exposed in some local Electron/webview
  // contexts even when `isSecureContext` is false. Try the native API first
  // and use the DOM fallback only when it rejects or is unavailable.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }

  try {
    if (typeof document === 'undefined' || !document.body) return false;

    const activeElement = document.activeElement as HTMLElement | null;
    const editable = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement ? activeElement : null;
    const selectionStart = editable?.selectionStart ?? null;
    const selectionEnd = editable?.selectionEnd ?? null;
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      return document.execCommand('copy');
    } finally {
      textArea.remove();
      // Copying from the terminal/chat must not leave focus in the hidden
      // fallback textarea; restore both keyboard focus and any selection.
      if (activeElement && activeElement.isConnected) {
        activeElement.focus({ preventScroll: true });
        if (editable && selectionStart !== null && selectionEnd !== null) {
          editable.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      if (selection && range) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  } catch {
    return false;
  }
}

/** Recover text from rich clipboard formats that omit text/plain. */
export function clipboardHtmlToText(html: string): string {
  if (!html) return '';
  // Clipboard HTML is untrusted. Extract text without sending it through any
  // browser HTML parser or DOM sink, including an inert document.
  const ignoredClosers = {
    head: /<\/\s*head\s*>/i,
    script: /<\/\s*script\s*>/i,
    style: /<\/\s*style\s*>/i,
    template: /<\/\s*template\s*>/i,
    title: /<\/\s*title\s*>/i,
  };
  const blocks = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'pre', 'section', 'tr']);
  const tagPattern = /<\s*(\/?)\s*([a-z][\w:-]*)\b/iy;
  let text = '';
  const lineBreak = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  let ignoredTag: keyof typeof ignoredClosers | null = null;
  let offset = 0;
  while (offset < html.length) {
    if (ignoredTag) {
      const closingTag = ignoredClosers[ignoredTag].exec(html.slice(offset));
      if (!closingTag) break;
      offset += closingTag.index + closingTag[0].length;
      ignoredTag = null;
      continue;
    }
    const tagStart = html.indexOf('<', offset);
    if (tagStart < 0) {
      text += decodeHTML(html.slice(offset));
      break;
    }
    text += decodeHTML(html.slice(offset, tagStart));
    if (html.startsWith('<!--', tagStart)) {
      const end = html.indexOf('-->', tagStart + 4);
      if (end < 0) break;
      offset = end + 3;
      continue;
    }
    if (html[tagStart + 1] === '!' || html[tagStart + 1] === '?') {
      const end = html.indexOf('>', tagStart + 2);
      if (end < 0) break;
      offset = end + 1;
      continue;
    }
    tagPattern.lastIndex = tagStart;
    const tagMatch = tagPattern.exec(html);
    if (!tagMatch) {
      text += '<';
      offset = tagStart + 1;
      continue;
    }
    let quote = '';
    let tagEnd = tagStart + tagMatch[0].length;
    for (; tagEnd < html.length; tagEnd++) {
      const char = html[tagEnd];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (tagEnd === html.length) break;
    const name = tagMatch[2].toLowerCase();
    const closing = Boolean(tagMatch[1]);
    if (!closing && (name === 'head' || name === 'script' || name === 'style' || name === 'template' || name === 'title')) {
      ignoredTag = name;
    } else if (name === 'br' || blocks.has(name)) {
      lineBreak();
    }
    offset = tagEnd + 1;
  }
  return text.replace(/^\n+|\n+$/g, '');
}

/** Read plain text first, then rich clipboard text when native apps omit text/plain. */
export async function readClipboardText(): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('Clipboard unavailable');
  try {
    const plain = await navigator.clipboard.readText();
    if (plain) return plain;
  } catch { /* Some clipboard providers expose only HTML through read(). */ }
  if (!navigator.clipboard.read) throw new Error('Clipboard text unavailable');
  const items = await navigator.clipboard.read();
  for (const item of items) {
    if (item.types.includes('text/plain')) {
      const plain = await (await item.getType('text/plain')).text();
      if (plain) return plain;
    }
    if (item.types.includes('text/html')) {
      const rich = clipboardHtmlToText(await (await item.getType('text/html')).text());
      if (rich) return rich;
    }
  }
  return '';
}
