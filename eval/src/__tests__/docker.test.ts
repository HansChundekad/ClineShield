import { dockerRunArgs, CLINE_VOLUME } from '../docker';

describe('dockerRunArgs', () => {
  it('mounts only the cline volume and results', () => {
    const args = dockerRunArgs({ image: 'clineshield-eval:abc1234', resultsDir: '/r/results/full-1', cmd: ['jiti', 'x.ts'] });
    expect(args).toEqual([
      'run', '--rm', '--user', 'eval', '-e', 'HOME=/home/eval',
      '-v', `${CLINE_VOLUME}:/home/eval/.cline`, '-v', '/r/results/full-1:/results',
      '--workdir', '/work', 'clineshield-eval:abc1234', 'jiti', 'x.ts',
    ]);
    const mounts = args.filter((_, i) => args[i - 1] === '-v');
    expect(mounts).toHaveLength(2);
    expect(mounts.some(m => m.includes('.cline-shield') || m.startsWith('/Users/') && !m.startsWith('/r/'))).toBe(false);
    expect(args).not.toContain('--privileged');
  });

  it('adds env entries before the image and supports -it', () => {
    const args = dockerRunArgs({ image: 'img', resultsDir: '/r/results', env: { CLINESHIELD_EVAL_TIMING: '1' }, cmd: ['cline', 'auth'], interactive: true });
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-it']);
    expect(args.indexOf('CLINESHIELD_EVAL_TIMING=1')).toBeLessThan(args.indexOf('img'));
    expect(args.slice(-3)).toEqual(['img', 'cline', 'auth']);
  });

  it('rejects a results dir that is not absolute or mounts a home config', () => {
    expect(() => dockerRunArgs({ image: 'img', resultsDir: 'rel', cmd: [] })).toThrow(/absolute/);
    expect(() => dockerRunArgs({ image: 'img', resultsDir: '/Users/x/.cline', cmd: [] })).toThrow(/results/);
  });
});
