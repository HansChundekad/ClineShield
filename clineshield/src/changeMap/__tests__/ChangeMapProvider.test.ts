jest.mock('vscode', () => require('../../__tests__/vscodeMock'), { virtual: true });

import * as vscode from 'vscode';
import { ChangeMapProvider } from '../ChangeMapProvider';

const mock = vscode as unknown as typeof import('../../__tests__/vscodeMock');

describe('ChangeMapProvider', () => {
  let provider: ChangeMapProvider;
  beforeEach(() => {
    mock.reset();
    provider = new ChangeMapProvider('/tmp/cs-changemap-none', 'ext', Date.now());
  });
  afterEach(() => provider.dispose());

  it.each(['create', 'change', 'delete'] as const)('metrics.json %s fires onDidChangeTreeData', kind => {
    const fired = jest.fn();
    provider.onDidChangeTreeData(fired);
    const w = mock.watchers.find(x => x.pattern === '.cline-shield/metrics.json')!;
    w.fire(kind);
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
