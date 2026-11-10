/**
 * Static checks on the sidebar webview: log-derived text (commands and paths
 * come from the agent) must never be parsed as HTML, and scripts need a CSP nonce.
 */

import * as fs from 'fs';
import * as path from 'path';

const html = fs.readFileSync(path.join(__dirname, '..', 'metrics.html'), 'utf-8');

describe('metrics.html', () => {
  it.each(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'])('never uses %s', api => {
    expect(html).not.toContain(api);
  });

  it('has a strict CSP with a script nonce', () => {
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-{{nonce}}'");
    expect(csp).not.toContain('unsafe-inline\'; script');
  });

  it('every script tag carries the nonce', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s).toContain('nonce="{{nonce}}"');
  });

  it('has no inline style attributes (blocked by the CSP)', () => {
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('has no em dashes in UI copy', () => {
    expect(html).not.toContain('—');
  });
});
