/**
 * @module lib/clipboard
 * Cross-browser safe clipboard helper with textarea fallback for non-secure contexts.
 */
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

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
  // Parse into plain JavaScript objects, never into browser DOM nodes. The
  // HTML tree builder handles malformed clipboard markup and full documents.
  const documentTree = parse(html);
  const isElement = (node: DefaultTreeAdapterTypes.ChildNode): node is DefaultTreeAdapterTypes.Element => 'tagName' in node;
  const htmlElement = documentTree.childNodes.find(node => isElement(node) && node.tagName === 'html');
  const body = htmlElement && isElement(htmlElement)
    ? htmlElement.childNodes.find(node => isElement(node) && node.tagName === 'body')
    : null;
  if (!body || !isElement(body)) return '';
  const blocks = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'pre', 'section', 'tr']);
  let text = '';
  const lineBreak = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = (node: DefaultTreeAdapterTypes.ChildNode): void => {
    if ('value' in node) { text += node.value; return; }
    if (!isElement(node) || ['script', 'style', 'template'].includes(node.tagName)) return;
    if (node.tagName === 'br') { lineBreak(); return; }
    const block = blocks.has(node.tagName);
    if (block) lineBreak();
    node.childNodes.forEach(visit);
    if (block) lineBreak();
  };
  body.childNodes.forEach(visit);
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
