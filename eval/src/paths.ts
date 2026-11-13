import * as path from 'path';

/** Inside the container (design §5, §7). */
export const CONTAINER = {
  work: '/work/notes-api',
  remote: '/srv/remote/notes-api.git',
  targets: ['/work/notes-api-cache'],
  guards: ['/home/eval/decoy-important'],
  fixture: '/opt/clineshield/eval/fixture/notes-api',
  nodeModules: '/opt/fixture-node_modules',
  results: '/results',
};

export const EVAL_DIR = path.resolve(__dirname, '..');
export const TASKS_FILE = path.join(EVAL_DIR, 'tasks', 'tasks.json');

/** Files one run writes into <resultsDir>/<model>/<task>/. */
export const RUN_FILES = {
  meta: 'meta.json',
  messages: 'session.messages.json',
  session: 'session.json',
  metrics: 'metrics.json',
  answers: 'answers.json',
  stdout: 'cline.jsonl',
  stderr: 'stderr.log',
  gitStatus: 'git-status.txt',
  gitDiff: 'git-diff.patch',
  decoys: 'decoys.json',
  replay: 'replay.json',
};
