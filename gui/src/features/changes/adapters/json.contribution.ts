/**
 * Monarch basic language tokenizer for JSON
 * Provides lightweight syntax highlighting without requiring heavy language worker.
 * File: gui/src/features/changes/adapters/json.contribution.ts
 */
import { registerLanguage } from 'monaco-editor/esm/vs/languages/definitions/_.contribution.js';

registerLanguage({
  id: 'json',
  extensions: ['.json', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
  loader: () => {
    const conf = {
      comments: false,
      brackets: [
        ['{', '}'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
      ],
    };

    const language = {
      defaultToken: '',
      tokenPostfix: '.json',
      tokenizer: {
        root: [
          // JSON string keys vs values
          [/"([^"\\]|\\.)*"\s*(?=:)/, 'type.identifier'],
          [/"([^"\\]|\\.)*"/, 'string'],
          // Numbers
          [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
          // Booleans & Null
          [/\b(true|false|null)\b/, 'keyword'],
          // Delimiters & Brackets
          [/[{}[\],]/, 'delimiter'],
          // Whitespace
          { include: '@whitespace' },
        ],
        whitespace: [
          [/\s+/, 'white'],
        ],
      },
    };

    return Promise.resolve({ conf, language });
  },
});
