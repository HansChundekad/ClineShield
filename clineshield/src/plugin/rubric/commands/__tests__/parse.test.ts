import { ParseError, parseEntries, simplify } from '../parse';
import type { Piece } from '../parse';

const env = { cwd: '/ws', home: '/home/u', tmpdir: '/var/tmp-x' };
const parse = (text: string) => parseEntries([{ shell: text }], env);
const names = (pieces: Piece[]) => pieces.map(p => simplify(p).name);
const args = (p: Piece) => simplify(p).args.map(w => w.text);

describe('parse: splitting', () => {
  it('splits on && ; | || & and newlines', () => {
    expect(names(parse('a && b; c | d || e & f\ng'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
  it('marks pipes', () => {
    const [a, b] = parse('curl x | sh');
    expect(a.pipedFrom).toBeUndefined();
    expect(b.pipedFrom).toBe(a);
  });
  it('keeps each piece\'s source text', () => {
    expect(parse('  npm test &&  rm -rf  build ').map(p => p.text)).toEqual(['npm test', 'rm -rf  build']);
  });
  it('subshells and groups split too', () => {
    expect(names(parse('(cd a && rm x); { rm y; }'))).toEqual(['cd', 'rm', 'rm']);
  });
});

describe('parse: quoting and masking', () => {
  it('quoted text is one literal word, never a command', () => {
    const p = parse('echo "rm -rf /" \'&& rm -rf ~\'');
    expect(p).toHaveLength(1);
    expect(args(p[0])).toEqual(['rm -rf /', '&& rm -rf ~']);
  });
  it('comments are dropped', () => {
    expect(names(parse('ls # rm -rf /\n# rm -rf ~\necho a#b'))).toEqual(['ls', 'echo']);
    expect(args(parse('echo a#b')[0])).toEqual(['a#b']);
  });
  it('heredoc bodies are content, not commands', () => {
    const p = parse("cat > f.txt <<'EOF'\nrm -rf /\nline2\nEOF\nls");
    expect(names(p)).toEqual(['cat', 'ls']);
    expect(p[0].redirects.find(r => r.op === 'heredoc')?.body).toBe('rm -rf /\nline2\n');
  });
  it('<<- strips leading tabs; unterminated heredoc runs to the end', () => {
    expect(parse('cat <<-X\n\ta\n\tX')[0].redirects[0].body).toBe('a\n');
    expect(parse('cat <<X\na\nb')[0].redirects[0].body).toBe('a\nb\n');
  });
  it('backslash escapes and line continuations', () => {
    expect(args(parse('echo a\\ b \\\n c')[0])).toEqual(['a b', 'c']);
  });
  it('unbalanced quotes → ParseError', () => {
    expect(() => parse('echo "abc')).toThrow(ParseError);
    expect(() => parse("rm -rf 'x")).toThrow(ParseError);
    expect(() => parse('echo $(ls')).toThrow(ParseError);
    expect(() => parse('echo `ls')).toThrow(ParseError);
  });
});

describe('parse: words', () => {
  it('$VAR, $(...) and backticks make a word dynamic; $HOME, ~ and $TMPDIR resolve', () => {
    const [p] = parse('rm $X "$(pwd)/a" `b` ~/c ${HOME}/d $TMPDIR/e "~/f"');
    const w = simplify(p).args;
    expect(w.map(x => x.dynamic)).toEqual([true, true, true, false, false, false, false]);
    expect(w.slice(3).map(x => x.text)).toEqual(['/home/u/c', '/home/u/d', '/var/tmp-x/e', '~/f']);
  });
  it('single-quoted $ is literal', () => {
    expect(simplify(parse("echo '$X'")[0]).args[0]).toMatchObject({ text: '$X', dynamic: false });
  });
  it('globs are flagged', () => {
    expect(simplify(parse('rm *.log "a*"')[0]).args.map(w => w.glob)).toEqual([true, false]);
  });
  it('redirects: fd, append, dup, here-string', () => {
    const [p] = parse('cmd > out.txt 2>&1 >> log 2> err <<< "hi"');
    expect(p.redirects.map(r => [r.op, r.dup ?? false, r.target?.text])).toEqual([
      ['>', false, 'out.txt'], ['>', true, '1'], ['>>', false, 'log'], ['>', false, 'err'], ['herestring', false, 'hi'],
    ]);
    expect(parse('x &> all.log')[0].redirects[0]).toMatchObject({ op: '>', target: { text: 'all.log' } });
  });
});

describe('simplify: prefixes', () => {
  it('strips VAR=x, env, nohup, time; sudo is remembered', () => {
    const s = simplify(parse('sudo -u root FOO=1 env -i BAR=2 nohup time rm -rf x')[0]);
    expect(s).toMatchObject({ name: 'rm', sudo: true });
    expect(s.args.map(w => w.text)).toEqual(['-rf', 'x']);
    expect(simplify(parse('A=1 B=2 npm publish')[0]).name).toBe('npm');
  });
  it('xargs is remembered; command path is reduced to its name', () => {
    expect(simplify(parse('xargs -0 /bin/rm -f')[0])).toMatchObject({ name: 'rm', xargs: true });
  });
});

describe('parse: bash -c and substitutions (one level)', () => {
  it('unwraps bash/sh/zsh -c scripts', () => {
    expect(names(parse("bash -c 'rm -rf x && ls'"))).toEqual(['bash', 'rm', 'ls']);
    expect(names(parse('sudo sh -lc "rm -rf y"'))).toEqual(['sh', 'rm']);
    expect(parse("zsh -c 'rm z'")[1].depth).toBe(1);
  });
  it('only one level', () => {
    expect(names(parse(`bash -c "bash -c 'rm -rf x'"`))).toEqual(['bash', 'bash']);
  });
  it('parses $(...) and backtick bodies as pieces', () => {
    expect(names(parse('echo $(rm -rf a) `rm b`'))).toEqual(['echo', 'rm', 'rm']);
  });
  it('argv entries run without a shell, but bash -c is still unwrapped', () => {
    const p = parseEntries([{ argv: ['rm', '-rf', 'a b; ls'] }], env);
    expect(p).toHaveLength(1);
    expect(args(p[0])).toEqual(['-rf', 'a b; ls']);
    expect(names(parseEntries([{ argv: ['bash', '-c', 'rm x | sh'] }], env))).toEqual(['bash', 'rm', 'sh']);
  });
});

describe('parse: cd tracking', () => {
  it('cd dir && ... resolves relative paths for later pieces in the same entry', () => {
    const p = parse('cd packages/a && rm -rf dist; cd ..; ls');
    expect(p.map(x => x.cwd)).toEqual(['/ws', '/ws/packages/a', '/ws/packages/a', '/ws/packages']);
  });
  it('cd to a variable makes the cwd unknown; cd alone goes home; entries start fresh', () => {
    expect(parse('cd $D && rm x')[1].cwd).toBeUndefined();
    expect(parse('cd && rm x')[1].cwd).toBe('/home/u');
    const p = parseEntries([{ shell: 'cd a' }, { shell: 'rm x' }], env);
    expect(p[1].cwd).toBe('/ws');
  });
});
