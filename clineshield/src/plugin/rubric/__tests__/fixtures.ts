import { buildChange } from '../gather';
import type { FileInfo } from '../gather';
import { parseApplyPatch } from '../../patch';
import type { ActionContext, CheckOptions, FileChange } from '../types';

export const ROOT = '/ws';
export const HOME = '/home/u';

/** One FileChange from apply_patch body lines (without Begin/End markers). */
export function change(body: string[], info: Partial<FileInfo> = {}): FileChange {
  const op = parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations[0];
  const abs = op.path.startsWith('/') ? op.path : `${ROOT}/${op.path}`;
  return buildChange(op, { binary: false, outsideWorkspace: false, ...info }, p => p.replace(/^\/ws\//, ''), abs);
}

export function update(file: string, removed: string[], added: string[], context: string[] = ['ctx']): string[] {
  return [`*** Update File: ${file}`, '@@', ...context.map(l => ` ${l}`), ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)];
}

export function action(changes: FileChange[], extra: Partial<ActionContext> = {}): ActionContext {
  return { workspaceRoot: ROOT, homeDir: HOME, pluginDir: '/plugins/clineshield', changes, codeownersGlobs: [], ...extra };
}

export const OPTS: CheckOptions = { protectedPaths: [], trustedDomains: [] };

export const ids = (findings: { category: string }[]) => findings.map(f => f.category);

/** A realistic 72-line class file; the first KEPT_HEAD lines survive a "different style" rewrite. */
export const KEPT_HEAD = 17;
export const PRODUCT_LINES: string[] = [
  "import { Money } from './money';",
  "import { Sku } from './sku';",
  "",
  "export interface ProductProps {",
  "  id: string;",
  "  name: string;",
  "  sku: Sku;",
  "  price: Money;",
  "  stock: number;",
  "}",
  "",
  "const MAX_NAME = 120;",
  "",
  "function clean(text: string): string {",
  "  return text.trim().replace(/\\s+/g, ' ');",
  "}",
  "",
  "export class Product {",
  "  private readonly props: ProductProps;",
  "",
  "  constructor(props: ProductProps) {",
  "    this.props = { ...props, name: clean(props.name) };",
  "    if (this.props.name.length > MAX_NAME) {",
  "      throw new Error('name too long');",
  "    }",
  "  }",
  "",
  "  get id(): string {",
  "    return this.props.id;",
  "  }",
  "",
  "  getName(): string {",
  "    return this.props.name;",
  "  }",
  "",
  "  rename(name: string): void {",
  "    this.props.name = clean(name);",
  "  }",
  "",
  "  getPrice(): Money {",
  "    return this.props.price;",
  "  }",
  "",
  "  setPrice(price: Money): void {",
  "    if (price.amount < 0) {",
  "      throw new Error('negative price');",
  "    }",
  "    this.props.price = price;",
  "  }",
  "",
  "  inStock(): boolean {",
  "    return this.props.stock > 0;",
  "  }",
  "",
  "  restock(count: number): void {",
  "    this.props.stock += count;",
  "  }",
  "",
  "  sell(count: number): void {",
  "    if (count > this.props.stock) {",
  "      throw new Error('not enough stock');",
  "    }",
  "    this.props.stock -= count;",
  "  }",
  "",
  "  toJSON(): ProductProps {",
  "    return { ...this.props };",
  "  }",
  "}",
  "",
];
export const PRODUCT_TEXT = PRODUCT_LINES.join('\n');
/** Replaces everything after the head with a differently named, functional version (no overlap in names). */
export const PRODUCT_REWRITE: string[] = [
  "export const makeItem = (props: ProductProps) => ({ ...props, name: props.name.trim() });",
  "export type Item = ReturnType<typeof makeItem>;",
  "const nameOf = (item: Item) => item.name;",
];
