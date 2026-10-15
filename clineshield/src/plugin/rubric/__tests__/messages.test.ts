import { askMessage, blockMessage } from '../messages';
import { scoreAction } from '../engine';
import { mergeConfigs } from '../../config/schema';
import { action, change, update } from './fixtures';

const cfg = mergeConfigs({}, {});

describe('messages', () => {
  it('block message: reasons and fix, no points or cut-offs', () => {
    const d = scoreAction(action([change(update('lib/a.ts', ['real()'], ['// ... rest of code unchanged']))]), cfg);
    const m = blockMessage(d);
    expect(m).toMatch(/^ClineShield blocked this action, so nothing was changed\./);
    expect(m).toMatch(/lib\/a\.ts: replaces existing code with a placeholder/);
    expect(m).toMatch(/Fix: Write out the full code/);
    expect(m).toMatch(/Don't retry the same change in smaller pieces/);
    expect(m).not.toMatch(/\b\d+ points?\b|cut-?off|\b(40|70)\b/);
  });

  it('ask message', () => {
    const d = scoreAction(action([change(['*** Delete File: lib/a.ts'], { gitDirty: true })]), cfg);
    const m = askMessage(d);
    expect(m).toMatch(/^ClineShield asked the user to approve this action\. Why: lib\/a\.ts: deletes lib\/a\.ts/);
    expect(m).toMatch(/If the user says no, don't retry the same action/);
  });

  it('errored with no findings', () => {
    expect(askMessage({ tier: 'ask', files: [], errored: true, errors: ['x'] })).toMatch(/could not check this action/);
  });
});
