import { CURRENCIES, isValidExpenseAmount, type CurrencyCode } from "./currency.js";
import { err, ok, type Result } from "./result.js";

export type CalculatorError = "EXPRESSION_INVALID" | "DIVISION_BY_ZERO" | "EXPENSE_AMOUNT_INVALID";

/** Longest expression the amount field evaluates. */
export const MAX_EXPRESSION_LENGTH = 100;

/** An exact fraction; `den` is always positive. */
interface Fraction {
  num: bigint;
  den: bigint;
}

class EvalError extends Error {
  constructor(readonly code: "EXPRESSION_INVALID" | "DIVISION_BY_ZERO") {
    super(code);
  }
}

const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

const fraction = (num: bigint, den: bigint): Fraction => {
  const sign = den < 0n ? -1n : 1n;
  const g = gcd(num, den) || 1n;
  return { num: (sign * num) / g, den: (sign * den) / g };
};

/**
 * Recursive-descent parser over exact fractions, never `eval`:
 *   expr   = term (("+" | "-") term)*
 *   term   = factor (("*" | "/") factor)*
 *   factor = number | "(" expr ")"
 *   number = digits ("." digits)?
 */
class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): Fraction {
    const value = this.expr();
    if (this.pos !== this.text.length) throw new EvalError("EXPRESSION_INVALID");
    return value;
  }

  private expr(): Fraction {
    let left = this.term();
    for (let op = this.peek(); op === "+" || op === "-"; op = this.peek()) {
      this.pos += 1;
      const right = this.term();
      const num = left.num * right.den + (op === "+" ? 1n : -1n) * right.num * left.den;
      left = fraction(num, left.den * right.den);
    }
    return left;
  }

  private term(): Fraction {
    let left = this.factor();
    for (let op = this.peek(); op === "*" || op === "/"; op = this.peek()) {
      this.pos += 1;
      const right = this.factor();
      if (op === "*") {
        left = fraction(left.num * right.num, left.den * right.den);
      } else {
        if (right.num === 0n) throw new EvalError("DIVISION_BY_ZERO");
        left = fraction(left.num * right.den, left.den * right.num);
      }
    }
    return left;
  }

  private factor(): Fraction {
    if (this.peek() === "(") {
      this.pos += 1;
      const inner = this.expr();
      if (this.peek() !== ")") throw new EvalError("EXPRESSION_INVALID");
      this.pos += 1;
      return inner;
    }
    const match = /^(\d+)(?:\.(\d+))?/.exec(this.text.slice(this.pos));
    if (!match) throw new EvalError("EXPRESSION_INVALID");
    this.pos += match[0].length;
    const decimals = match[2] ?? "";
    return fraction(BigInt((match[1] ?? "") + decimals), 10n ** BigInt(decimals.length));
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }
}

/**
 * Evaluates the amount field's arithmetic ("120+80") into minor units of `currency`.
 * Only digits, ".", + - * / and parentheses are accepted; the result is rounded half up to
 * the currency's smallest unit and must be a valid Expense amount.
 */
export function evaluateAmount(
  text: string,
  currency: CurrencyCode,
): Result<number, CalculatorError> {
  if (text.length > MAX_EXPRESSION_LENGTH || !/^[0-9.+\-*/()]+$/.test(text)) {
    return err("EXPRESSION_INVALID");
  }
  let value: Fraction;
  try {
    value = new Parser(text).parse();
  } catch (e) {
    if (e instanceof EvalError) return err(e.code);
    throw e;
  }
  if (value.num <= 0n) return err("EXPENSE_AMOUNT_INVALID");
  const scaled = value.num * 10n ** BigInt(CURRENCIES[currency].decimals);
  const minor = (2n * scaled + value.den) / (2n * value.den);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return err("EXPENSE_AMOUNT_INVALID");
  const result = Number(minor);
  return isValidExpenseAmount(result) ? ok(result) : err("EXPENSE_AMOUNT_INVALID");
}
