/**
 * Parallel Cline sessions each run the plugin in their own process, so
 * appendAnswer()'s in-process queue does not serialise them; the lock file
 * (answers.json.lock, same lock as metrics.json) does. Runs real separate
 * Node processes against one answers.json and checks no answer is lost.
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

const PROCESSES = 4;
const ANSWERS_PER_PROCESS = 15;
const SOURCES = ['plugin/answers.ts', 'plugin/rubric/approval.ts', 'metrics/writer.ts', 'metrics/tempSweep.ts'];

const WORKER_SOURCE = `
const { appendAnswer } = require('./plugin/answers.js');
const [root, label, count] = process.argv.slice(2);
Promise.all(Array.from({ length: Number(count) }, (_, i) => appendAnswer(root, {
  sessionId: label, toolCallId: label + '-' + i, answeredAt: new Date().toISOString(), answer: 'no',
}))).then(() => process.exit(0));
`;

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? -1));
  });
}

describe('answers.json under concurrent writes from separate processes', () => {
  let dir: string;
  let root: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-ans-xproc-'));
    root = path.join(dir, 'workspace');
    for (const rel of SOURCES) {
      const source = await fs.readFile(path.join(__dirname, '..', '..', rel), 'utf-8');
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      });
      const out = path.join(dir, rel.replace(/\.ts$/, '.js'));
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, outputText);
    }
    await fs.writeFile(path.join(dir, 'worker.js'), WORKER_SOURCE);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps every answer and leaves no temp or lock files', async () => {
    const codes = await Promise.all(Array.from({ length: PROCESSES }, (_, p) =>
      run(path.join(dir, 'worker.js'), [root, `proc-${p}`, String(ANSWERS_PER_PROCESS)])));
    expect(codes).toEqual(Array(PROCESSES).fill(0));

    const parsed = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'answers.json'), 'utf-8')) as { entries: Array<{ toolCallId: string }> };
    expect(parsed.entries).toHaveLength(PROCESSES * ANSWERS_PER_PROCESS);
    expect(new Set(parsed.entries.map(e => e.toolCallId)).size).toBe(PROCESSES * ANSWERS_PER_PROCESS);
    expect(await fs.readdir(path.join(root, '.cline-shield'))).toEqual(['answers.json']);
  }, 20000);
});
