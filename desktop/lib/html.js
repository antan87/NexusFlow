/**
 * Escapes HTML special characters in strings to prevent unescaped interpolation in data-URL HTML views.
 *
 * @param {string} str - Raw input string.
 * @returns {string} Sanitized string safe for HTML interpolation.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
