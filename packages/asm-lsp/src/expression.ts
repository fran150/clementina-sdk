/**
 * Evaluates the constant expressions of ca65 source well enough to show a
 * value on hover: numbers, characters, symbols, parentheses, the unary
 * operators `- ~ ! < > ^` and the binary operators `* / & | ^ << >> + -` and
 * comparisons. Anything else (`.sizeof`, `*`, an import) makes it unknown.
 */
import {tokenize, type Token} from './parser.js';

export type SymbolValue = (name: string) => number | undefined;

/** The value of a number token such as `$7000`, `%1010`, `640` or `'A'`, or undefined. */
export function numberValue(text: string): number | undefined {
  if (/^\$[0-9a-f]+$/iu.test(text)) return parseInt(text.slice(1), 16);
  if (/^%[01]+$/u.test(text)) return parseInt(text.slice(1), 2);
  if (/^[0-9]+$/u.test(text)) return parseInt(text, 10);
  if (/^'.'$/u.test(text)) return text.charCodeAt(1);
  return undefined;
}

const binary: Array<Record<string, (left: number, right: number) => number>> = [
  {'||': (a, b) => Number(Boolean(a) || Boolean(b)), '.or': (a, b) => Number(Boolean(a) || Boolean(b))},
  {'&&': (a, b) => Number(Boolean(a) && Boolean(b)), '.and': (a, b) => Number(Boolean(a) && Boolean(b))},
  {'=': (a, b) => Number(a === b), '<>': (a, b) => Number(a !== b), '<': (a, b) => Number(a < b), '>': (a, b) => Number(a > b), '<=': (a, b) => Number(a <= b), '>=': (a, b) => Number(a >= b)},
  {'+': (a, b) => a + b, '-': (a, b) => a - b, '|': (a, b) => a | b, '.bitor': (a, b) => a | b},
  {'*': (a, b) => a * b, '/': (a, b) => Math.trunc(a / b), '.mod': (a, b) => a % b, '&': (a, b) => a & b, '.bitand': (a, b) => a & b, '^': (a, b) => a ^ b, '.bitxor': (a, b) => a ^ b, '<<': (a, b) => a << b, '.shl': (a, b) => a << b, '>>': (a, b) => a >> b, '.shr': (a, b) => a >> b},
];

/** Join operator characters that ca65 reads as one: `<<`, `>>`, `<=`, `>=`, `<>`, `&&`, `||`. */
function joinOperators(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const previous = out.at(-1);
    if (previous?.kind === 'operator' && token.kind === 'operator' && previous.end === token.start && ['<<', '>>', '<=', '>=', '<>', '&&', '||'].includes(previous.text + token.text)) {
      out[out.length - 1] = {...previous, text: previous.text + token.text, end: token.end};
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Evaluate an expression, or return undefined when any part of it is unknown. */
export function evaluate(text: string, lookup: SymbolValue): number | undefined {
  const tokens = joinOperators(tokenize(text));
  let index = 0;
  const peek = () => tokens[index];
  const operatorText = (token: Token | undefined) => token && (token.kind === 'operator' || token.kind === 'directive') ? token.text.toLowerCase() : undefined;

  const primary = (): number | undefined => {
    const token = tokens[index++];
    if (!token) return undefined;
    switch (token.kind) {
      case 'number': case 'char': return numberValue(token.text);
      case 'identifier': case 'local': return lookup(token.text);
      case 'directive': {
        const name = token.text.toLowerCase();
        if (['.lobyte', '.hibyte', '.bankbyte', '.loword', '.hiword'].includes(name) && peek()?.text === '(') {
          index += 1;
          const value = expression(0);
          if (peek()?.text !== ')') return undefined;
          index += 1;
          if (value === undefined) return undefined;
          return {'.lobyte': value & 0xff, '.hibyte': (value >> 8) & 0xff, '.bankbyte': (value >> 16) & 0xff, '.loword': value & 0xffff, '.hiword': (value >>> 16) & 0xffff}[name];
        }
        return undefined;
      }
      case 'operator': {
        if (token.text === '(') {
          const value = expression(0);
          if (peek()?.text !== ')') return undefined;
          index += 1;
          return value;
        }
        const value = unary();
        if (value === undefined) return undefined;
        switch (token.text) {
          case '-': return -value;
          case '+': return value;
          case '~': return ~value;
          case '!': return Number(!value);
          case '<': return value & 0xff;
          case '>': return (value >> 8) & 0xff;
          case '^': return (value >> 16) & 0xff;
          default: return undefined;
        }
      }
      default: return undefined;
    }
  };
  const unary = (): number | undefined => {
    const token = peek();
    if (token?.kind === 'operator' && ['-', '+', '~', '!', '<', '>', '^'].includes(token.text)) {
      index += 1;
      const value = unary();
      if (value === undefined) return undefined;
      return {'-': -value, '+': value, '~': ~value, '!': Number(!value), '<': value & 0xff, '>': (value >> 8) & 0xff, '^': (value >> 16) & 0xff}[token.text];
    }
    return primary();
  };
  const expression = (level: number): number | undefined => {
    if (level >= binary.length) return unary();
    let left = expression(level + 1);
    for (;;) {
      const op = operatorText(peek());
      const apply = op === undefined ? undefined : binary[level]![op];
      if (!apply) return left;
      index += 1;
      const right = expression(level + 1);
      if (left === undefined || right === undefined) return undefined;
      left = apply(left, right);
    }
  };
  const value = expression(0);
  return index === tokens.length ? value : undefined;
}

/** Show a value as `$hex (decimal)`, with the binary for a byte. */
export function formatValue(value: number): string {
  if (value < 0) return `${value}`;
  const digits = value > 0xffff ? 6 : value > 0xff ? 4 : 2;
  const hex = `$${value.toString(16).toUpperCase().padStart(digits, '0')}`;
  const binaryText = value <= 0xff ? `, %${value.toString(2).padStart(8, '0')}` : '';
  return `${hex} (${value}${binaryText})`;
}
