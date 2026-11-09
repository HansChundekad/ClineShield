#!/usr/bin/env node
/**
 * Regenerates the bundled lists behind `dep_typosquat`
 * (src/plugin/rubric/deps/data/top-{npm,pypi}.txt). Run by hand; never at
 * install or run time. Commit the result.
 *
 * npm:  wooorm/npm-high-impact (MIT), ranked by downloads; scoped names dropped.
 * PyPI: hugovk/top-pypi-packages (30-day downloads).
 */

const fs = require('fs');
const path = require('path');

const LIMIT = 5000;
const NPM_URL = 'https://raw.githubusercontent.com/wooorm/npm-high-impact/main/lib/top.js';
const PYPI_URL = 'https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.min.json';
const NAME = /^[a-z0-9][a-z0-9._-]{0,213}$/;
const OUT = path.join(__dirname, '..', 'src', 'plugin', 'rubric', 'deps', 'data');

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Valid, unique, first LIMIT; refuses a suspiciously short result. */
function clean(names, label) {
  const out = [...new Set(names.map(n => n.toLowerCase()))].filter(n => NAME.test(n)).slice(0, LIMIT);
  if (out.length < LIMIT) throw new Error(`${label}: only ${out.length} valid names`);
  return out;
}

async function main() {
  const npmText = await get(NPM_URL);
  const npm = clean([...npmText.matchAll(/^\s*'([^']+)',?$/gm)].map(m => m[1]), 'npm');
  const pypi = clean(JSON.parse(await get(PYPI_URL)).rows.map(r => r.project), 'pypi');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'top-npm.txt'), `${npm.join('\n')}\n`);
  fs.writeFileSync(path.join(OUT, 'top-pypi.txt'), `${pypi.join('\n')}\n`);
  console.log(`wrote ${npm.length} npm and ${pypi.length} PyPI names`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
