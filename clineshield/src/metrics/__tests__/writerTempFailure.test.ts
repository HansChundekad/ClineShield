import * as os from 'os';
import * as path from 'path';
import type { MetricsEvent } from '../../types/metrics';

// A temp write that fails part-way (e.g. disk full) must not leave the temp behind.
let failTempWrites = false;
jest.mock('fs/promises', () => {
  const real = jest.requireActual('fs/promises');
  return {
    ...real,
    writeFile: async (p: string, data: string, opts: unknown) => {
      if (failTempWrites && String(p).endsWith('.tmp')) {
        await real.writeFile(p, '[', 'utf-8');
        throw new Error('ENOSPC');
      }
      return real.writeFile(p, data, opts);
    },
  };
});

import * as fs from 'fs/promises';
import { appendEvent } from '../writer';

it('appendEvent leaves no temp when writing it fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-wfail-'));
  try {
    failTempWrites = true;
    await appendEvent({ timestamp: new Date().toISOString(), sessionId: 's', type: 'session-start', data: {} } as unknown as MetricsEvent, root);
    const left = (await fs.readdir(path.join(root, '.cline-shield'))).filter(f => f.endsWith('.tmp'));
    expect(left).toEqual([]);
  } finally {
    failTempWrites = false;
    await fs.rm(root, { recursive: true, force: true });
  }
});
