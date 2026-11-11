import * as path from 'path';
import { createInstallWatch } from '../installWatch';
import { pluginWatchTargets } from '../setup';

const tick = () => new Promise(r => setImmediate(r));

describe('createInstallWatch', () => {
  it('checks once on start and reports found when the plugin is already installed', async () => {
    const onFound = jest.fn();
    const watch = createInstallWatch(async () => true, onFound);
    await tick();
    expect(watch.found).toBe(true);
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it('flips to found on the first poke after the install, and calls onFound once', async () => {
    let installed = false;
    const onFound = jest.fn();
    const watch = createInstallWatch(async () => installed, onFound);
    await tick();
    watch.poke();
    await tick();
    expect(watch.found).toBe(false);
    expect(onFound).not.toHaveBeenCalled();
    installed = true;
    watch.poke();
    watch.poke();
    await tick();
    await tick();
    expect(watch.found).toBe(true);
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it('stops checking once found', async () => {
    const check = jest.fn(async () => true);
    const watch = createInstallWatch(check, () => undefined);
    await tick();
    watch.poke();
    watch.poke();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('runs one check at a time and re-checks once if poked during a check', async () => {
    let running = 0;
    let maxRunning = 0;
    const check = jest.fn(async () => {
      running++; maxRunning = Math.max(maxRunning, running);
      await tick();
      running--;
      return false;
    });
    const watch = createInstallWatch(check, () => undefined);
    watch.poke();
    watch.poke();
    watch.poke();
    for (let i = 0; i < 6; i++) await tick();
    expect(maxRunning).toBe(1);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a failing check leaves it not found and does not throw', async () => {
    const watch = createInstallWatch(async () => { throw new Error('boom'); }, () => undefined);
    await tick();
    expect(() => watch.poke()).not.toThrow();
    await tick();
    expect(watch.found).toBe(false);
  });

  it('does nothing after dispose', async () => {
    let installed = false;
    const onFound = jest.fn();
    const watch = createInstallWatch(async () => installed, onFound);
    await tick();
    watch.dispose();
    installed = true;
    watch.poke();
    await tick();
    expect(onFound).not.toHaveBeenCalled();
  });
});

describe('pluginWatchTargets', () => {
  it('watches plugins/** under ~/.cline and .cline/plugins/** under the workspace', () => {
    expect(pluginWatchTargets('/h', '/ws', {})).toEqual([
      { base: path.join('/h', '.cline'), pattern: 'plugins/**' },
      { base: '/ws', pattern: '.cline/plugins/**' },
    ]);
  });

  it('honours CLINE_DIR and works without a workspace', () => {
    expect(pluginWatchTargets('/h', undefined, { CLINE_DIR: '/c' })).toEqual([{ base: '/c', pattern: 'plugins/**' }]);
  });
});
