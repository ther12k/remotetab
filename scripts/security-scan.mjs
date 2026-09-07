#!/usr/bin/env node
// RemoteTab static security guardrail (blueprint §14, issue #020).
// Flags forbidden APIs / selectors / generic CDP passthrough in source and build output.
// This is a guardrail, not a substitute for review.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Directory prefixes scanned (source + built output). Docs intentionally excluded:
// they legitimately name forbidden APIs when describing the policy.
const SCAN_DIRS = ['apps', 'packages', 'scripts'];
const TEST_HINT = /(test|spec)\.[tj]sx?$/;

// [token, reason] — this file itself is excluded from scanning below because it
// must contain the literal forbidden tokens to define the policy.
const FORBIDDEN = [
  ['chrome.cookies', 'cookie API must never be used (credential exfiltration)'],
  ['Network.getAllCookies', 'CDP cookie extraction is forbidden'],
  ['Storage.getCookies', 'CDP cookie extraction is forbidden'],
  ['data-message-author-role', 'ChatGPT DOM selector — output scraping is forbidden'],
  ['sendCdp', 'generic peer-to-CDP bridge is forbidden (ADR-004)'],
  ['"cdp.command"', 'generic CDP protocol message type is forbidden'],
  ["'cdp.command'", 'generic CDP protocol message type is forbidden'],
];

// Forbidden manifest permissions (SECURITY_THREAT_MODEL §6).
const FORBIDDEN_PERMISSIONS = [
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'history',
  'nativeMessaging',
  '<all_urls>',
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const findings = [];

const SELF = join(ROOT, 'scripts', 'security-scan.mjs');

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (file === SELF) continue;
    const ext = extname(file);
    if (!['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html'].includes(ext)) continue;
    if (file.endsWith('package-lock.json')) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = file.slice(ROOT.length);
    const isTest = TEST_HINT.test(rel);
    for (const [token, reason] of FORBIDDEN) {
      if (text.includes(token)) {
        // Tests may legitimately contain forbidden tokens as negative fixtures;
        // production code may not.
        findings.push({ file: rel, token, reason, allowed: isTest });
      }
    }
    if (rel.endsWith('manifest.json')) {
      let manifest;
      try {
        manifest = JSON.parse(text);
      } catch {
        findings.push({
          file: rel,
          token: '<unparsable manifest.json>',
          reason: 'manifest must be valid JSON',
          allowed: false,
        });
        continue;
      }
      const perms = new Set([
        ...(manifest.permissions ?? []),
        ...Object.keys(manifest.host_permissions ?? {}),
      ]);
      for (const perm of FORBIDDEN_PERMISSIONS) {
        if (perms.has(perm)) {
          findings.push({
            file: rel,
            token: `permission:${perm}`,
            reason: 'forbidden extension permission',
            allowed: false,
          });
        }
      }
    }
  }
}

const violations = findings.filter((f) => !f.allowed);
for (const f of violations) {
  console.error(`FORBIDDEN [${f.token}] in ${f.file}: ${f.reason}`);
}
if (findings.some((f) => f.allowed)) {
  console.warn('note: forbidden tokens present in test fixtures only (allowed as negative tests)');
}

if (violations.length > 0) {
  console.error(`security-scan: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log('security-scan: clean');
