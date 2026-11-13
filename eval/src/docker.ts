/** docker CLI arguments for eval containers (design §7.1). No shell, no host mounts besides results. */
import * as path from 'path';

export const CLINE_VOLUME = 'clineshield-eval-cline';

export interface DockerRunOptions {
  image: string;
  resultsDir: string;
  cmd: string[];
  env?: Record<string, string>;
  interactive?: boolean;
}

export function dockerRunArgs(o: DockerRunOptions): string[] {
  if (!path.isAbsolute(o.resultsDir)) throw new Error('resultsDir must be absolute');
  if (/(^|\/)\.cline(-shield)?(\/|$)/.test(o.resultsDir) || !o.resultsDir.includes('results')) throw new Error(`refusing to mount ${o.resultsDir}: only an eval results dir may be mounted`);
  return [
    'run', '--rm', ...(o.interactive ? ['-it'] : []), '--user', 'eval', '-e', 'HOME=/home/eval',
    ...Object.entries(o.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-v', `${CLINE_VOLUME}:/home/eval/.cline`, '-v', `${o.resultsDir}:/results`,
    '--workdir', '/work', o.image, ...o.cmd,
  ];
}
