import { execFile } from 'child_process';

const GIT_TIMEOUT_MS = 1000;

/**
 * The folder whose .cline-shield/metrics.json the plugin writes for a session
 * started in `folder`. Matches how Cline sets ctx.workspaceInfo.rootPath:
 * `git rev-parse --show-toplevel`, or the folder itself outside a git repo.
 * Never rejects.
 */
export function resolveMetricsRoot(folder: string): Promise<string> {
  return new Promise(resolve => {
    execFile('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      const root = error ? '' : stdout.trim();
      resolve(root || folder);
    });
  });
}
