import { contentCheck } from '../content';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>, opts = OPTS) => contentCheck.run(c, action([c]), opts);
const added = (file: string, lines: string[], info = {}) => run(change(update(file, [], lines), info));

describe('contentCheck', () => {
  it.each([
    'const agent = new https.Agent({ rejectUnauthorized: false });',
    "res.setHeader('Access-Control-Allow-Origin', '*');",
    "app.use(cors({ origin: '*' }));",
    'const r = eval(userInput);',
    "const f = new Function('a', body);",
    "exec(`rm ${dir}`, cb); // child_process",
    'subprocess.run(cmd, shell=True)',
    'os.system(cmd)',
    '<div dangerouslySetInnerHTML={{ __html: html }} />',
    'app.use(csrf({ csrf: false }));',
    'http.csrf().disable();',
    'requests.get(url, verify=False)',
  ])('security_weakened: %s', line => {
    expect(ids(added('src/a.ts', [line]))).toContain('security_weakened');
  });

  it('does not flag regex.exec or evaluate()', () => {
    expect(added('src/a.ts', ['const m = re.exec(s);', 'page.evaluate(fn);'])).toEqual([]);
  });

  it('auth_removed / validation_removed fire on net removal only', () => {
    expect(ids(run(change(update('src/r.ts', ['router.get("/a", requireAuth, h);'], ['router.get("/a", h);']))))).toContain('auth_removed');
    expect(run(change(update('src/r.ts', ['router.get("/a", requireAuth, h);'], ['router.get("/b", requireAuth, h);'])))).toEqual([]);
    expect(ids(run(change(update('src/r.ts', ['const body = schema.validate(req.body);'], ['const body = req.body;']))))).toContain('validation_removed');
    expect(ids(run(change(update('app.py', ['@login_required'], []))))).toContain('auth_removed');
  });

  it.each([
    'db.query("SELECT * FROM users WHERE id = " + id);',
    'db.query(`DELETE FROM t WHERE id = ${id}`);',
    'cur.execute(f"SELECT * FROM t WHERE name = {name}")',
    'cur.execute("UPDATE t SET a = %s" % a)',
  ])('sql_string_built: %s', line => {
    expect(ids(added('src/db.ts', [line]))).toContain('sql_string_built');
  });

  it('parameterised SQL is fine', () => {
    expect(added('src/db.ts', ["db.query('SELECT * FROM users WHERE id = $1', [id]);"])).toEqual([]);
  });

  it('new_domain: unknown host fires; known, trusted and local hosts do not', () => {
    expect(ids(added('src/a.ts', ["fetch('https://evil.io/x')"], { original: "fetch('https://api.github.com')\n" }))).toEqual(['new_domain']);
    expect(added('src/a.ts', ["fetch('https://api.github.com/y')"], { original: "fetch('https://api.github.com')\n" })).toEqual([]);
    expect(run(change(update('src/a.ts', [], ["fetch('https://a.corp.com')"])), { ...OPTS, trustedDomains: ['corp.com'] })).toEqual([]);
    expect(added('src/a.ts', ["fetch('http://localhost:3000')", "u = 'https://example.com'"])).toEqual([]);
  });

  it('empty catch', () => {
    expect(ids(added('src/a.ts', ['} catch (e) {}']))).toEqual(['empty_catch']);
    expect(ids(added('a.py', ['except Exception:', '    pass']))).toEqual(['empty_catch']);
  });

  it('commented-out block of 5+ code lines', () => {
    const block = ['// const a = 1;', '// if (a) {', '//   run(a);', '// }', '// return a;'];
    expect(ids(added('src/a.ts', block))).toEqual(['commented_out_block']);
    expect(added('src/a.ts', ['// This explains', '// the algorithm', '// in prose', '// over several', '// lines'])).toEqual([]);
  });
});
