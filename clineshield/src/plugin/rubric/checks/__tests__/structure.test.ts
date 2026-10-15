import { definitions, structureCheck } from '../structure';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>) => structureCheck.run(c, action([c]), OPTS);

describe('definitions', () => {
  it.each([
    ['js', 'export async function load(a) {', 'load'],
    ['js', 'const handler = async (req) => {', 'handler'],
    ['js', 'class Foo extends Bar {', 'Foo'],
    ['js', '  async save(item) {', 'save'],
    ['py', 'def parse(x):', 'parse'],
    ['py', '    async def fetch(self):', 'fetch'],
    ['go', 'func (s *Server) Start(ctx context.Context) error {', 'Start'],
    ['java', '  public static int add(int a, int b) {', 'add'],
    ['rs', 'pub async fn run() -> Result<()> {', 'run'],
    ['rb', 'def self.call(x)', 'call'],
  ] as const)('%s: %s → %s', (lang, line, name) => {
    expect([...definitions([line], lang).keys()]).toEqual([name]);
  });
  it('does not treat control flow as methods', () => {
    expect(definitions(['  if (x) {', '  for (const a of b) {', '  while (y) {'], 'js').size).toBe(0);
  });
});

describe('structureCheck', () => {
  it('counts removed functions not re-added (10 each, max 40)', () => {
    const f = run(change(update('a.ts', ['function a() {}', 'function b() {}', 'function keep() {}'], ['function keep() { return 1; }'])));
    const fr = f.find(x => x.category === 'functions_removed')!;
    expect(fr.weight).toBe(0.5);
    expect(fr.counts?.functionsDeleted).toBe(2);
    expect(ids(f)).toContain('signature_changed');
  });

  it('exports removed or renamed', () => {
    const f = run(change(update('a.ts', ['export function oldName() {}'], ['export function newName() {}'])));
    expect(f.find(x => x.category === 'exports_removed')?.counts?.exportsDeleted).toBe(1);
  });

  it('go: capitalised names are exports', () => {
    const f = run(change(update('a.go', ['func Public() {}', 'func private() {}'], [])));
    expect(f.find(x => x.category === 'exports_removed')?.counts?.exportsDeleted).toBe(1);
    expect(f.find(x => x.category === 'functions_removed')?.counts?.functionsDeleted).toBe(2);
  });

  it('env key renamed', () => {
    const f = run(change(update('a.ts', ['const u = process.env.DB_URL;'], ['const u = process.env.DATABASE_URL;'])));
    expect(ids(f)).toContain('env_key_renamed');
    const env = run(change(update('.env.example', ['API_HOST=x'], ['API_URL=x'])));
    expect(ids(env)).toContain('env_key_renamed');
  });

  it('skips new and deleted files and unknown languages for definitions', () => {
    expect(run(change(['*** Delete File: a.ts']))).toEqual([]);
    expect(run(change(update('a.md', ['# def x():'], [])))).toEqual([]);
  });
});
