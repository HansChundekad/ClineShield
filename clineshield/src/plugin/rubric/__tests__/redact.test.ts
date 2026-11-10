import { REDACTED, redactSecrets } from '../redact';

describe('redactSecrets', () => {
  it('replaces an AWS access key and keeps the rest of the line', () => {
    expect(redactSecrets('const k = "AKIAABCDEFGHIJKLMNOP"; // aws')).toBe(`const k = "${REDACTED}"; // aws`);
  });

  it('replaces every occurrence, not just the first', () => {
    const tok = (c: string) => `ghp_${c.repeat(36)}`;
    const out = redactSecrets(`a=${tok('a')}\nb=${tok('b')}`);
    expect(out).toBe(`a=${REDACTED}\nb=${REDACTED}`);
  });

  it('replaces a private key header and a quoted api_key assignment', () => {
    expect(redactSecrets('-----BEGIN RSA PRIVATE KEY-----')).toBe(REDACTED);
    const out = redactSecrets('api_key = "abcd1234efgh5678ijkl9012"');
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('abcd1234efgh5678ijkl9012');
  });

  it('leaves ordinary code unchanged', () => {
    expect(redactSecrets('const x = 1;')).toBe('const x = 1;');
    expect(redactSecrets('')).toBe('');
  });
});
