import { normaliseCommands } from '../normalise';

describe('normaliseCommands: all 9 RunCommandsInputUnionSchema shapes', () => {
  const sh = (text: string) => ({ shell: text });
  const argv = (...a: string[]) => ({ argv: a });

  it.each([
    ['{commands: string[]}', { commands: ['ls', 'pwd'] }, [sh('ls'), sh('pwd')]],
    ['{commands: (string|{command,args})[]}', { commands: ['ls', { command: 'rm', args: ['-rf', 'x'] }] }, [sh('ls'), argv('rm', '-rf', 'x')]],
    ['{commands: string}', { commands: 'ls -la' }, [sh('ls -la')]],
    ['{commands: {command,args}}', { commands: { command: 'git', args: ['status'] } }, [argv('git', 'status')]],
    ['{command,args}[]', [{ command: 'npm', args: ['test'] }, { command: 'ls' }], [argv('npm', 'test'), argv('ls')]],
    ['{command,args}', { command: 'rm', args: ['a b'] }, [argv('rm', 'a b')]],
    ['{command: string}', { command: 'rm -rf build && ls' }, [sh('rm -rf build && ls')]],
    ['{cmd: string}', { cmd: 'echo hi' }, [sh('echo hi')]],
    ['string[]', ['ls', 'pwd'], [sh('ls'), sh('pwd')]],
    ['string', 'ls', [sh('ls')]],
  ])('%s', (_name, input, expected) => {
    expect(normaliseCommands(input)).toEqual(expected);
  });

  it('{command} with args is argv (no shell); without args it is a shell string', () => {
    expect(normaliseCommands({ command: 'ls -la' })).toEqual([sh('ls -la')]);
    expect(normaliseCommands({ command: 'ls -la', args: [] })).toEqual([argv('ls -la')]);
  });

  it.each([
    ['null', null], ['number', 3], ['empty object', {}], ['bad array entry', ['ls', 3]],
    ['empty command', { command: '' }], ['args not strings', { command: 'ls', args: [1] }],
    ['commands of numbers', { commands: [1, 2] }], ['empty list', []], ['empty commands list', { commands: [] }],
  ])('no shape → undefined (%s)', (_name, input) => {
    expect(normaliseCommands(input)).toBeUndefined();
  });
});
