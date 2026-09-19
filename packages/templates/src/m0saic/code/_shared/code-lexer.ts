/** Deterministic, dependency-free TypeScript/JavaScript syntax lexer. */

import type { CodeTokenKind } from "./code-theme";

export type CodeLanguage = "ts" | "js";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
  /** Zero-based character-grid column in the normalized line. */
  col: number;
}

export interface LexedCodeLine {
  text: string;
  tokens: CodeToken[];
}

export interface LexedCodeState {
  /** CRLF-normalized, tab-expanded source. */
  code: string;
  language: CodeLanguage;
  lines: LexedCodeLine[];
}

export interface LexTsJsOptions {
  tabWidth?: number;
}

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "false",
  "finally", "for", "from", "function", "get", "if", "import", "in", "instanceof",
  "let", "new", "null", "of", "return", "set", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while",
  "with", "yield",
]);

const TS_ONLY_KEYWORDS = new Set([
  "abstract", "any", "as", "asserts", "bigint", "boolean", "declare", "enum",
  "global", "implements", "infer", "interface", "is", "keyof", "module", "namespace",
  "never", "number", "object", "override", "private", "protected", "public", "readonly",
  "require", "satisfies", "string", "symbol", "type", "unknown",
]);

const PUNCTUATION = new Set(["(", ")", "{", "}", "[", "]", ";", ",", ":", "."]);
const OPERATOR_CHARS = new Set(Array.from("+-*/%=!<>&|^~?"));

interface TemplateFrame {
  inExpression: boolean;
  braceDepth: number;
}

interface LexerState {
  inBlockComment: boolean;
  templates: TemplateFrame[];
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function pushToken(
  tokens: CodeToken[],
  text: string,
  kind: CodeTokenKind,
  col: number,
): void {
  if (text.length === 0) return;
  const previous = tokens[tokens.length - 1];
  if (
    previous?.kind === kind &&
    previous.col + Array.from(previous.text).length === col
  ) {
    previous.text += text;
  } else {
    tokens.push({ text, kind, col });
  }
}

function scanQuoted(line: string, start: number, quote: "'" | '"'): number {
  let index = start + 1;
  while (index < line.length) {
    if (line[index] === "\\") index += 2;
    else if (line[index] === quote) return index + 1;
    else index += 1;
  }
  return line.length;
}

function scanNumber(line: string, start: number): number {
  const match = line.slice(start).match(
    /^(?:0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?n?)/,
  );
  return match == null ? start + 1 : start + match[0].length;
}

function isKeyword(identifier: string, language: CodeLanguage): boolean {
  return JS_KEYWORDS.has(identifier) ||
    (language === "ts" && TS_ONLY_KEYWORDS.has(identifier));
}

function scanTemplateText(
  line: string,
  start: number,
  opening: boolean,
  tokens: CodeToken[],
  state: LexerState,
): number {
  let index = opening ? start + 1 : start;
  while (index < line.length) {
    if (line[index] === "\\") {
      index = Math.min(line.length, index + 2);
      continue;
    }
    if (line[index] === "`") {
      index += 1;
      pushToken(tokens, line.slice(start, index), "string", start);
      state.templates.pop();
      return index;
    }
    if (line[index] === "$" && line[index + 1] === "{") {
      index += 2;
      pushToken(tokens, line.slice(start, index), "string", start);
      const frame = state.templates[state.templates.length - 1]!;
      frame.inExpression = true;
      frame.braceDepth = 0;
      return index;
    }
    index += 1;
  }
  pushToken(tokens, line.slice(start), "string", start);
  return line.length;
}

function lexLine(
  line: string,
  language: CodeLanguage,
  state: LexerState,
): LexedCodeLine {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    if (state.inBlockComment) {
      const close = line.indexOf("*/", index);
      const end = close < 0 ? line.length : close + 2;
      pushToken(tokens, line.slice(index, end), "comment", index);
      index = end;
      if (close < 0) break;
      state.inBlockComment = false;
      continue;
    }

    const template = state.templates[state.templates.length - 1];
    if (template && !template.inExpression) {
      index = scanTemplateText(line, index, false, tokens, state);
      continue;
    }

    const char = line[index]!;
    const next = line[index + 1] ?? "";

    if (/\s/.test(char)) {
      let end = index + 1;
      while (end < line.length && /\s/.test(line[end]!)) end += 1;
      pushToken(tokens, line.slice(index, end), "plain", index);
      index = end;
      continue;
    }

    if (char === "/" && next === "/") {
      pushToken(tokens, line.slice(index), "comment", index);
      break;
    }
    if (char === "/" && next === "*") {
      const close = line.indexOf("*/", index + 2);
      const end = close < 0 ? line.length : close + 2;
      pushToken(tokens, line.slice(index, end), "comment", index);
      index = end;
      state.inBlockComment = close < 0;
      continue;
    }

    if (char === "'" || char === '"') {
      const end = scanQuoted(line, index, char);
      pushToken(tokens, line.slice(index, end), "string", index);
      index = end;
      continue;
    }

    if (char === "`") {
      state.templates.push({ inExpression: false, braceDepth: 0 });
      index = scanTemplateText(line, index, true, tokens, state);
      continue;
    }

    if (template?.inExpression && char === "}") {
      if (template.braceDepth === 0) {
        pushToken(tokens, char, "string", index);
        template.inExpression = false;
      } else {
        pushToken(tokens, char, "punct", index);
        template.braceDepth -= 1;
      }
      index += 1;
      continue;
    }
    if (template?.inExpression && char === "{") {
      template.braceDepth += 1;
      pushToken(tokens, char, "punct", index);
      index += 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end]!)) end += 1;
      const identifier = line.slice(index, end);
      let lookahead = end;
      while (lookahead < line.length && /\s/.test(line[lookahead]!)) lookahead += 1;
      const kind: CodeTokenKind = isKeyword(identifier, language)
        ? "keyword"
        : line[lookahead] === "("
          ? "fnCall"
          : "ident";
      pushToken(tokens, identifier, kind, index);
      index = end;
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(next))) {
      const end = scanNumber(line, index);
      pushToken(tokens, line.slice(index, end), "number", index);
      index = end;
      continue;
    }

    if (OPERATOR_CHARS.has(char)) {
      let end = index + 1;
      while (end < line.length && OPERATOR_CHARS.has(line[end]!)) end += 1;
      pushToken(tokens, line.slice(index, end), "operator", index);
      index = end;
      continue;
    }

    if (PUNCTUATION.has(char)) {
      pushToken(tokens, char, "punct", index);
      index += 1;
      continue;
    }

    pushToken(tokens, char, "plain", index);
    index += 1;
  }

  return { text: line, tokens };
}

export function normalizeCodeSource(code: string, tabWidth = 2): string {
  if (typeof code !== "string") {
    throw new Error("normalizeCodeSource: code must be a string");
  }
  if (!Number.isInteger(tabWidth) || tabWidth < 1 || tabWidth > 16) {
    throw new Error(
      `normalizeCodeSource: tabWidth must be an integer from 1 to 16, got ${tabWidth}`,
    );
  }
  return code.replace(/\r\n?/g, "\n").replace(/\t/g, " ".repeat(tabWidth));
}

/**
 * Lex TS/JS without parser dependencies. Regex literals are the documented v1
 * gap: their characters still retain exact columns but use operator/ident/etc.
 */
export function lexTsJs(
  code: string,
  language: CodeLanguage = "ts",
  options: LexTsJsOptions = {},
): LexedCodeState {
  if (language !== "ts" && language !== "js") {
    throw new Error(`lexTsJs: language must be "ts" or "js", got ${JSON.stringify(language)}`);
  }
  const normalized = normalizeCodeSource(code, options.tabWidth ?? 2);
  const state: LexerState = { inBlockComment: false, templates: [] };
  return {
    code: normalized,
    language,
    lines: normalized.split("\n").map((line) => lexLine(line, language, state)),
  };
}
