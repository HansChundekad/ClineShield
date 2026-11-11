/**
 * The sidebar loads src/sidebar/metrics.html at runtime, so a packaged VSIX
 * must include it even though .vscodeignore excludes src/**.
 */
import * as fs from 'fs';
import * as path from 'path';

const lines = fs.readFileSync(path.join(__dirname, '..', '..', '.vscodeignore'), 'utf-8').split('\n').map(l => l.trim());

describe('.vscodeignore', () => {
  it('re-includes the sidebar webview after excluding src/**', () => {
    const exclude = lines.indexOf('src/**');
    const include = lines.indexOf('!src/sidebar/metrics.html');
    expect(include).toBeGreaterThan(exclude);
  });

  it('no longer lists the removed 1.x hooks folder', () => {
    expect(lines).not.toContain('!hooks/**');
  });
});
