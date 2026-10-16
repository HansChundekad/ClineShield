/**
 * normalise.ts
 *
 * run_commands input → a list of entries. Accepts every shape of the SDK's
 * RunCommandsInputUnionSchema (cline/cline main @ ee7f4f5,
 * sdk/packages/core/src/extensions/tools/schemas.ts L127-172; SPEC.md
 * Appendix). A `{command, args}` entry runs without a shell, so it stays argv.
 * Pure; returns undefined when the input matches no shape.
 */

/** One command: a shell string, or argv run directly (no shell parsing). */
export type CommandEntry = { shell: string } | { argv: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** `{command, args?}` (StructuredCommandInputSchema: command non-empty, args string[]). */
function structured(x: unknown): CommandEntry | undefined {
  if (!isObj(x) || typeof x.command !== 'string' || x.command === '') return undefined;
  if (x.args === undefined) return { argv: [x.command] };
  if (!Array.isArray(x.args) || !x.args.every(a => typeof a === 'string')) return undefined;
  return { argv: [x.command, ...(x.args as string[])] };
}

/** StructuredCommandEntrySchema: a shell string or `{command, args?}`. */
const entry = (x: unknown): CommandEntry | undefined => (typeof x === 'string' ? { shell: x } : structured(x));

function all(list: unknown[], one: (x: unknown) => CommandEntry | undefined): CommandEntry[] | undefined {
  if (list.length === 0) return undefined;
  const out = list.map(one);
  return out.every(Boolean) ? (out as CommandEntry[]) : undefined;
}

export function normaliseCommands(input: unknown): CommandEntry[] | undefined {
  if (typeof input === 'string') return [{ shell: input }];
  if (Array.isArray(input)) {
    // string[] or {command, args?}[]
    return input.every(x => typeof x === 'string') ? all(input, entry) : all(input, structured);
  }
  if (!isObj(input)) return undefined;
  if ('commands' in input) {
    const c = input.commands;
    if (Array.isArray(c)) return all(c, entry);
    const one = entry(c);
    return one ? [one] : undefined;
  }
  if (typeof input.command === 'string') {
    // {command: string} is a shell string; with args it is StructuredCommandInputSchema.
    if (input.args === undefined) return input.command === '' ? undefined : [{ shell: input.command }];
    const s = structured(input);
    return s ? [s] : undefined;
  }
  if (typeof input.cmd === 'string') return [{ shell: input.cmd }];
  return undefined;
}
