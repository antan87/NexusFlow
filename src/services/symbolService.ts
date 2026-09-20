import { createRequire } from 'node:module';
import path from 'node:path';
import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter';

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SymbolKindLabel =
  | 'class'
  | 'interface'
  | 'constructor'
  | 'method'
  | 'function'
  | 'property'
  | 'type'
  | 'enum'
  | 'variable';

export const MonacoSymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

export interface ExtractedSymbol {
  name: string;
  kind: number;
  kindLabel: SymbolKindLabel;
  lineNumber: number;
  endLineNumber?: number;
  column: number;
  containerName?: string;
}

interface LanguageInfo {
  langName: string;
  wasmFile: string;
}

function getLanguageInfo(filePath: string): LanguageInfo | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'cs':
      return { langName: 'c-sharp', wasmFile: 'tree-sitter-c-sharp.wasm' };
    case 'ts':
    case 'mts':
    case 'cts':
      return { langName: 'typescript', wasmFile: 'tree-sitter-typescript.wasm' };
    case 'tsx':
      return { langName: 'tsx', wasmFile: 'tree-sitter-tsx.wasm' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { langName: 'javascript', wasmFile: 'tree-sitter-javascript.wasm' };
    case 'jsx':
      return { langName: 'tsx', wasmFile: 'tree-sitter-tsx.wasm' };
    case 'py':
      return { langName: 'python', wasmFile: 'tree-sitter-python.wasm' };
    case 'go':
      return { langName: 'go', wasmFile: 'tree-sitter-go.wasm' };
    case 'rs':
      return { langName: 'rust', wasmFile: 'tree-sitter-rust.wasm' };
    default:
      return null;
  }
}

let parserInitialized = false;
let initPromise: Promise<void> | null = null;
const loadedLanguages = new Map<string, Language>();

async function ensureParserInitialized(): Promise<void> {
  if (parserInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      await Parser.init();
      parserInitialized = true;
    })();
  }
  return initPromise;
}

function resolveWasmPath(filename: string): string {
  try {
    const req = createRequire(import.meta.url);
    return req.resolve(`@vscode/tree-sitter-wasm/wasm/${filename}`);
  } catch {
    const directPath = path.resolve(process.cwd(), 'node_modules/@vscode/tree-sitter-wasm/wasm', filename);
    if (existsSync(directPath)) {
      return directPath;
    }
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/@vscode/tree-sitter-wasm/wasm', filename);
  }
}

async function getLanguage(wasmFile: string): Promise<Language | null> {
  if (loadedLanguages.has(wasmFile)) {
    return loadedLanguages.get(wasmFile)!;
  }
  try {
    const wasmPath = resolveWasmPath(wasmFile);
    const lang = await Language.load(wasmPath);
    loadedLanguages.set(wasmFile, lang);
    return lang;
  } catch (err) {
    console.error(`Failed to load tree-sitter WASM grammar for ${wasmFile}:`, err);
    return null;
  }
}

function findIdentifierChild(node: SyntaxNode): SyntaxNode | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode;
  for (const child of node.children) {
    if (
      child.type === 'identifier' ||
      child.type === 'type_identifier' ||
      child.type === 'property_identifier' ||
      child.type === 'field_identifier'
    ) {
      return child;
    }
  }
  return null;
}

export async function extractAstSymbols(
  filePath: string,
  content: string
): Promise<ExtractedSymbol[]> {
  const langInfo = getLanguageInfo(filePath);
  if (!langInfo || !content.trim()) {
    return [];
  }

  try {
    await ensureParserInitialized();
    const lang = await getLanguage(langInfo.wasmFile);
    if (!lang) {
      return [];
    }

    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    if (!tree) {
      return [];
    }
    const symbols: ExtractedSymbol[] = [];

    const walk = (node: SyntaxNode, containerName?: string) => {
      let currentContainer = containerName;
      let sym: ExtractedSymbol | null = null;

      switch (langInfo.langName) {
        case 'c-sharp': {
          switch (node.type) {
            case 'class_declaration':
            case 'record_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Class,
                  kindLabel: 'class',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
                // Support C# 12 Primary Constructors
                const paramList = node.children.find((c) => c.type === 'parameter_list');
                if (paramList) {
                  symbols.push({
                    name: nameNode.text,
                    kind: MonacoSymbolKind.Constructor,
                    kindLabel: 'constructor',
                    lineNumber: paramList.startPosition.row + 1,
                    endLineNumber: paramList.endPosition.row + 1,
                    column: paramList.startPosition.column + 1,
                    containerName: nameNode.text,
                  });
                }
              }
              break;
            }
            case 'interface_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Interface,
                  kindLabel: 'interface',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'struct_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Struct,
                  kindLabel: 'class',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'enum_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Enum,
                  kindLabel: 'enum',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'constructor_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Constructor,
                  kindLabel: 'constructor',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'method_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Method,
                  kindLabel: 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'property_declaration':
            case 'indexer_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Property,
                  kindLabel: 'property',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
          }
          break;
        }

        case 'typescript':
        case 'tsx':
        case 'javascript': {
          switch (node.type) {
            case 'class_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Class,
                  kindLabel: 'class',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'interface_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Interface,
                  kindLabel: 'interface',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'type_alias_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.TypeParameter,
                  kindLabel: 'type',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'enum_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Enum,
                  kindLabel: 'enum',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'function_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Function,
                  kindLabel: 'function',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'method_definition': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                const isCtor = nameNode.text === 'constructor';
                sym = {
                  name: nameNode.text,
                  kind: isCtor ? MonacoSymbolKind.Constructor : MonacoSymbolKind.Method,
                  kindLabel: isCtor ? 'constructor' : 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'public_field_definition':
            case 'field_definition':
            case 'property_definition':
            case 'property_signature': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Property,
                  kindLabel: 'property',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'method_signature': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Method,
                  kindLabel: 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'variable_declarator': {
              const nameNode = findIdentifierChild(node);
              const val = node.childForFieldName('value');
              if (nameNode) {
                const isFn =
                  val &&
                  (val.type === 'arrow_function' ||
                    val.type === 'function_expression' ||
                    val.type === 'function');
                sym = {
                  name: nameNode.text,
                  kind: isFn ? MonacoSymbolKind.Function : MonacoSymbolKind.Variable,
                  kindLabel: isFn ? 'function' : 'variable',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
          }
          break;
        }

        case 'python': {
          switch (node.type) {
            case 'class_definition': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Class,
                  kindLabel: 'class',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'function_definition': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                const isCtor =
                  containerName !== undefined &&
                  (nameNode.text === '__init__' || nameNode.text === '__new__');
                const isProp =
                  node.parent?.type === 'decorated_definition' &&
                  node.parent.children.some(
                    (c) => c.type === 'decorator' && c.text.includes('property')
                  );
                const isMethod = containerName !== undefined && !isCtor && !isProp;
                sym = {
                  name: nameNode.text,
                  kind: isCtor
                    ? MonacoSymbolKind.Constructor
                    : isProp
                    ? MonacoSymbolKind.Property
                    : isMethod
                    ? MonacoSymbolKind.Method
                    : MonacoSymbolKind.Function,
                  kindLabel: isCtor ? 'constructor' : isProp ? 'property' : isMethod ? 'method' : 'function',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: (node.parent?.type === 'decorated_definition' ? node.parent : node).endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'expression_statement': {
              if (containerName && node.children.some((c) => c.type === 'assignment')) {
                const assign = node.children.find((c) => c.type === 'assignment')!;
                const left = assign.childForFieldName('left') || assign.children[0];
                if (left && (left.type === 'identifier' || left.type === 'type_identifier')) {
                  sym = {
                    name: left.text,
                    kind: MonacoSymbolKind.Property,
                    kindLabel: 'property',
                    lineNumber: left.startPosition.row + 1,
                    endLineNumber: node.endPosition.row + 1,
                    column: left.startPosition.column + 1,
                    containerName,
                  };
                }
              }
              break;
            }
          }
          break;
        }

        case 'go': {
          switch (node.type) {
            case 'type_spec': {
              const nameNode = findIdentifierChild(node);
              const typeChild = node.childForFieldName('type');
              if (nameNode) {
                const isIface = typeChild?.type === 'interface_type';
                const isStruct = typeChild?.type === 'struct_type';
                sym = {
                  name: nameNode.text,
                  kind: isIface
                    ? MonacoSymbolKind.Interface
                    : isStruct
                    ? MonacoSymbolKind.Class
                    : MonacoSymbolKind.TypeParameter,
                  kindLabel: isIface ? 'interface' : isStruct ? 'class' : 'type',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'method_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Method,
                  kindLabel: 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'method_elem':
            case 'method_spec': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Method,
                  kindLabel: 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'field_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Property,
                  kindLabel: 'property',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'function_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Function,
                  kindLabel: 'function',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
          }
          break;
        }

        case 'rust': {
          switch (node.type) {
            case 'struct_item': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Class,
                  kindLabel: 'class',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'enum_item': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Enum,
                  kindLabel: 'enum',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'trait_item': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Interface,
                  kindLabel: 'interface',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'impl_item': {
              const typeNode = node.childForFieldName('type');
              if (typeNode) {
                currentContainer = typeNode.text;
              }
              break;
            }
            case 'field_declaration': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Property,
                  kindLabel: 'property',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'function_item': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                const isMethod = Boolean(containerName);
                sym = {
                  name: nameNode.text,
                  kind: isMethod ? MonacoSymbolKind.Method : MonacoSymbolKind.Function,
                  kindLabel: isMethod ? 'method' : 'function',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
            case 'function_signature_item': {
              const nameNode = findIdentifierChild(node);
              if (nameNode) {
                sym = {
                  name: nameNode.text,
                  kind: MonacoSymbolKind.Method,
                  kindLabel: 'method',
                  lineNumber: nameNode.startPosition.row + 1,
                  endLineNumber: node.endPosition.row + 1,
                  column: nameNode.startPosition.column + 1,
                  containerName,
                };
              }
              break;
            }
          }
          break;
        }
      }

      if (sym) {
        symbols.push(sym);
        currentContainer = sym.name;
      }

      for (const child of node.children) {
        walk(child, currentContainer);
      }
    };

    walk(tree.rootNode);
    return symbols;
  } catch (err) {
    console.error(`Error extracting AST symbols for ${filePath}:`, err);
    return [];
  }
}
