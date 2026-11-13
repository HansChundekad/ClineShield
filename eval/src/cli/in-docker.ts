/**
 * Host helper: run one eval CLI inside the eval container with <resultsDir> mounted at /results.
 * Usage: npx jiti@2.7.0 eval/src/cli/in-docker.ts <resultsDir> <script.ts> [args...]
 * Uses clineshield-eval:<HEAD short sha>, so commit and build before running.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { dockerRunArgs } from '../docker';

const [dirArg, script, ...rest] = process.argv.slice(2);
if (!dirArg || !script) { console.error('usage: in-docker.ts <resultsDir> <script.ts> [args...]'); process.exit(2); }
const resultsDir = path.resolve(dirArg);
fs.mkdirSync(resultsDir, { recursive: true });
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
const r = spawnSync('docker', dockerRunArgs({ image: `clineshield-eval:${sha}`, resultsDir, cmd: ['jiti', `/opt/clineshield/eval/src/cli/${script}`, ...rest] }), { stdio: 'inherit' });
process.exit(r.status ?? 1);
