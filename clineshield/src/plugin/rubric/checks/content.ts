/**
 * content.ts
 *
 * Content categories: patterns in added lines (auth/validation: net removal).
 */

import type { Check, RawFinding } from '../types';

const SECURITY: RegExp[] = [
  /rejectUnauthorized\s*:\s*false/,
  /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
  /\bverify\s*=\s*False\b/,
  /InsecureSkipVerify\s*:\s*true/,
  /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/,
  /\borigins?\s*[:=]\s*\[?\s*['"]\*['"]/,
  /allow_origins\s*=\s*\[\s*['"]\*['"]/,
  /(^|[^.\w])(eval|exec)\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bexecSync\s*\(|child_process['"]?\)?\.exec\s*\(|\bshell\s*:\s*true\b|\bshell\s*=\s*True\b|\bos\.system\s*\(/,
  /dangerouslySetInnerHTML/,
  /\bcsrf\s*:\s*false|csrf\(\)\.disable\(\)|@csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False|skip_forgery_protection|protect_from_forgery\s+except/,
];

const AUTH = /\b(authenticate|authorize|authorise|requireAuth|requireLogin|requireUser|requireRole|login_required|permission_required|isAuthenticated|ensureAuthenticated|ensureLoggedIn|checkPermissions?|hasPermission|hasRole|isAdmin|verifyToken|verifyJwt|canActivate|UseGuards|PreAuthorize|Secured|RolesAllowed|authMiddleware|before_action\s+:authenticate\w*)\b|jwt\.verify|passport\.authenticate/;
const VALIDATION = /\b(validat\w*|sanitiz\w*|sanitis\w*|escapeHtml|DOMPurify|Joi\.\w+|yup\.\w+|z\.(object|string|number|array)|@Valid\w*|@Is[A-Z]\w*)/;

const SQL_VERB = String.raw`\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b`;
const SQL: RegExp[] = [
  new RegExp(String.raw`['"][^'"]*${SQL_VERB}[^'"]*['"]\s*\+`, 'i'),
  new RegExp(String.raw`\x60[^\x60]*${SQL_VERB}[^\x60]*\$\{`, 'i'),
  new RegExp(String.raw`\bf['"][^'"]*${SQL_VERB}[^'"]*\{`, 'i'),
  new RegExp(String.raw`['"][^'"]*${SQL_VERB}[^'"]*['"]\s*(%|\.format\()`, 'i'),
];

const URL_HOST = /https?:\/\/([a-z0-9.-]+)/gi;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|(.+\.)?example\.(com|org|net))$/i;
const EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
const PY_EXCEPT = /^\s*except\b[^:]*:\s*(pass)?\s*$/;
const CODE_COMMENT = /^\s*(\/\/|#)(?!!).*[;{}()=]/;

const countMatches = (lines: string[], r: RegExp) => lines.filter(l => r.test(l)).length;
const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export const contentCheck: Check = {
  name: 'content',
  kind: 'signal',
  run(c, _a, o) {
    if (c.kind === 'delete') return [];
    const out: RawFinding[] = [];
    const add = (category: RawFinding['category'], detail: string) => out.push({ category, weight: 1, detail });

    const sec = c.added.find(l => SECURITY.some(r => r.test(l)));
    if (sec) add('security_weakened', `weakens a security setting ("${sec.trim().slice(0, 80)}")`);
    if (countMatches(c.removed, AUTH) > countMatches(c.added, AUTH)) add('auth_removed', 'removes an authentication or permission check');
    if (countMatches(c.removed, VALIDATION) > countMatches(c.added, VALIDATION)) add('validation_removed', 'removes input validation');
    if (c.added.some(l => SQL.some(r => r.test(l)))) add('sql_string_built', 'builds an SQL query from strings');

    const known = c.original ?? c.removed.join('\n');
    const hosts = new Set<string>();
    for (const l of c.added) for (const m of l.matchAll(URL_HOST)) hosts.add(m[1].toLowerCase());
    const fresh = [...hosts].filter(h => !known.toLowerCase().includes(h) && !LOCAL_HOSTS.test(h) && !o.trustedDomains.some(d => isUnder(h, d.toLowerCase())));
    if (fresh.length) add('new_domain', `calls a new domain: ${fresh.slice(0, 3).join(', ')}`);

    const pyEmpty = c.added.some((l, i) => PY_EXCEPT.test(l) && (/:\s*pass\s*$/.test(l) || /^\s*pass\s*$/.test(c.added[i + 1] ?? '')));
    if (c.added.some(l => EMPTY_CATCH.test(l)) || pyEmpty) add('empty_catch', 'adds an error handler that ignores the error');

    let run = 0;
    for (const l of c.added) {
      run = CODE_COMMENT.test(l) ? run + 1 : 0;
      if (run >= 5) { add('commented_out_block', 'adds a block of commented-out code'); break; }
    }
    return out;
  },
};
