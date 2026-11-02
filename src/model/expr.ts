// Small, safe math-expression evaluator for numeric fields and variables.
// Supports + - * / % ^, parentheses, variables, functions, and unit suffixes (10 mm, 1 in, 45 deg).
// Trig functions work in degrees, which is what people expect in CAD.

import type { NumExpr, Variable } from './types';

const UNITS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  deg: 1,
  rad: 180 / Math.PI,
};

const D2R = Math.PI / 180;
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (x) => Math.sin(x * D2R),
  cos: (x) => Math.cos(x * D2R),
  tan: (x) => Math.tan(x * D2R),
  asin: (x) => Math.asin(x) / D2R,
  acos: (x) => Math.acos(x) / D2R,
  atan: (x) => Math.atan(x) / D2R,
  atan2: (y, x) => Math.atan2(y, x) / D2R,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
};

const CONSTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, e: Math.E };

export const RESERVED_NAMES = new Set([...Object.keys(UNITS), ...Object.keys(FUNCS), ...Object.keys(CONSTS)]);

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`Unexpected "${c}"`);
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/%^(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new Error(`Unexpected "${c}"`);
    }
  }
  return out;
}

class Parser {
  private pos = 0;
  private toks: Token[];
  private scope: Record<string, number>;

  constructor(toks: Token[], scope: Record<string, number>) {
    this.toks = toks;
    this.scope = scope;
  }

  parse(): number {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new Error('Unexpected input after expression');
    return v;
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private isOp(v: string) {
    const t = this.peek();
    return t?.t === 'op' && t.v === v;
  }

  private nextOp(): string {
    return (this.toks[this.pos++] as { v: string }).v;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.nextOp();
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.factor();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.nextOp();
      const r = this.factor();
      if (op === '*') v *= r;
      else if (op === '/') {
        if (r === 0) throw new Error('Division by zero');
        v /= r;
      } else v %= r;
    }
    return v;
  }

  private factor(): number {
    const base = this.unary();
    if (this.isOp('^')) {
      this.pos++;
      return Math.pow(base, this.factor());
    }
    return base;
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.pos++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): number {
    let v = this.primary();
    const t = this.peek();
    if (t?.t === 'id' && t.v in UNITS) {
      this.pos++;
      v *= UNITS[t.v];
    }
    return v;
  }

  private primary(): number {
    const t = this.toks[this.pos++];
    if (!t) throw new Error('Expression ends too early');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = this.expr();
      if (!this.isOp(')')) throw new Error('Missing ")"');
      this.pos++;
      return v;
    }
    if (t.t === 'id') {
      if (this.isOp('(')) {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`Unknown function "${t.v}"`);
        this.pos++;
        const args: number[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.pos++;
            args.push(this.expr());
          }
        }
        if (!this.isOp(')')) throw new Error('Missing ")"');
        this.pos++;
        return fn(...args);
      }
      if (t.v in this.scope) return this.scope[t.v];
      if (t.v in CONSTS) return CONSTS[t.v];
      throw new Error(`Unknown name "${t.v}"`);
    }
    throw new Error(`Unexpected "${t.v}"`);
  }
}

export function evalExpression(src: string, scope: Record<string, number> = {}): number {
  const trimmed = src.trim();
  if (!trimmed) throw new Error('Enter a value');
  const v = new Parser(tokenize(trimmed), scope).parse();
  if (!Number.isFinite(v)) throw new Error('Result is not a finite number');
  return v;
}

export function evalNum(value: NumExpr, scope: Record<string, number> = {}): number {
  if (typeof value === 'number') return value;
  return evalExpression(value, scope);
}

/** Evaluates variables in order; each may use the ones defined above it. */
export function evalVariables(vars: Variable[]): { scope: Record<string, number>; errors: Record<string, string> } {
  const scope: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const v of vars) {
    try {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)) throw new Error('Names use letters, digits, and _');
      if (RESERVED_NAMES.has(v.name)) throw new Error(`"${v.name}" is a reserved name`);
      scope[v.name] = evalExpression(v.expr, scope);
    } catch (e) {
      errors[v.name] = (e as Error).message;
    }
  }
  return { scope, errors };
}

/** Parses user input: plain numbers stay numbers so documents stay readable. */
export function parseNumInput(text: string): NumExpr {
  const t = text.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return parseFloat(t);
  return t;
}

export function formatNum(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? '0' : String(r);
}
