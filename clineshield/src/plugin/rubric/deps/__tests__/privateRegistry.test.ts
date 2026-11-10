import { privateEcosystems } from '../privateRegistry';

describe('privateEcosystems', () => {
  // Fake timers stop the cap's timer from firing, so the reads always finish first:
  // the worst case of the race a 0 ms cap used to lose only sometimes.
  afterEach(() => jest.useRealTimers());

  it('no time to read means private and timed out, even if the reads would be instant', async () => {
    jest.useFakeTimers();
    expect(await privateEcosystems(['/ws'], '/home/u', {}, 0)).toEqual({ npm: true, pypi: true, timedOut: true });
  });

  it('with time, missing config means public', async () => {
    expect(await privateEcosystems(['/ws'], '/home/u', {}, 5000)).toEqual({ npm: false, pypi: false });
  });
});
