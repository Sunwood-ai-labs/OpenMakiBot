import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const upstreamOnly = ['release.yml', 'prepare-release.yml', 'npm-package.yml', 'sync-published-release.yml'];
const guard = "github.repository == 'milind-soni/OpenMausBot'";

function hasWrite(permissions) {
  if (permissions === undefined || permissions === 'read-all') return false;
  if (permissions === 'write-all') return true;
  assert(permissions && typeof permissions === 'object' && !Array.isArray(permissions), 'unsupported permissions form');
  const values = Object.values(permissions);
  assert(values.every((value) => ['read', 'write', 'none'].includes(value)), 'unsupported permission value');
  return values.includes('write');
}
function guarded(file, name, condition, expected = guard) {
  assert(typeof condition === 'string', `${file}/${name}: missing repository guard`);
  assert(condition === expected || condition.startsWith(`${expected} && `), `${file}/${name}: missing repository guard`);
  // An OR inside the right-hand conjunct is safe (release/CLA event filters),
  // but an OR at the top level can bypass the repository restriction.
  let depth = 0;
  let quote = '';
  for (let i = 0; i < condition.length; i++) {
    const char = condition[i];
    if (quote) {
      if (char === quote) {
        if (condition[i + 1] === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      assert(depth >= 0, `${file}/${name}: unbalanced guard expression`);
    } else if (condition.slice(i, i + 2) === '||') {
      assert(depth > 0, `${file}/${name}: guard must not be bypassed with OR`);
      i++;
    }
  }
  assert(depth === 0 && !quote, `${file}/${name}: unbalanced guard expression`);
}

function usesExternalSecret(job) {
  // GitHub permissions do not describe authority granted by external tokens.
  // In particular, Wrangler can deploy with contents:read and a Cloudflare key.
  const source = JSON.stringify(job).replaceAll(/secrets\.GITHUB_TOKEN\b/g, '');
  return /\bsecrets\s*(?:\.|\[)/.test(source);
}

export function validateWorkflow(file, source) {
  const doc = parseDocument(source, { uniqueKeys: true, merge: true });
  assert.equal(doc.errors.length, 0, `${file}: ${doc.errors.join('; ')}`);
  const workflow = doc.toJS();
  assert(workflow?.jobs && Object.keys(workflow.jobs).length, `${file}: missing jobs`);
  hasWrite(workflow.permissions);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const privileged = hasWrite(job.permissions ?? workflow.permissions);
    if (file === 'sync-upstream.yml') {
      assert.equal(name, 'sync', 'unexpected upstream sync job');
      guarded(file, name, job.if, "github.repository == 'Sunwood-ai-labs/OpenMakiBot'");
      assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], 'upstream sync must remain manual');
      assert.deepEqual(job.permissions ?? workflow.permissions, { contents: 'write', 'pull-requests': 'write' });
    } else if (privileged || usesExternalSecret(job) || upstreamOnly.includes(file) || (file === 'docker.yml' && name === 'publish')) {
      guarded(file, name, job.if);
    }
  }
  return workflow;
}

export function validateForkCi(workflow) {
  const platforms = ['macos-latest', 'ubuntu-latest', 'windows-latest'];
  const legacy = workflow.jobs['legacy-platform-checks'];
  assert(legacy, 'ci.yml: protected platform checks missing');
  assert.equal(legacy.name, 'typecheck + test (${{ matrix.os }})', 'ci.yml: protected platform check names changed');
  assert.deepEqual(legacy.strategy?.matrix?.os, platforms, 'ci.yml: protected platform checks missing');
  assert.equal(legacy.needs, 'gate', 'ci.yml: protected platform checks must depend on CI');
  assert.equal(legacy.if, "github.repository == 'Sunwood-ai-labs/OpenMakiBot' && !cancelled()", 'ci.yml: platform checks must report failures');
  assert.equal(legacy.steps[0]?.env?.CI_RESULT, '${{ needs.gate.result }}', 'ci.yml: platform checks must read the CI result');
  assert.equal(workflow.jobs.static.outputs.vitest_os, '${{ steps.fork-scope.outputs.vitest_os || steps.scope.outputs.vitest_os }}', 'ci.yml: fork platform coverage missing');
  const scope = workflow.jobs.static.steps.find((step) => step.id === 'fork-scope');
  assert.equal(scope?.if, "github.repository == 'Sunwood-ai-labs/OpenMakiBot'", 'ci.yml: fork platform coverage guard missing');
  assert(scope.run.includes(JSON.stringify(platforms)), 'ci.yml: every protected platform must actually run');
  for (const [job, expected] of [['control-plane', 'control-plane check + workerd tests + dry run'], ['package-linux', 'package + smoke (Ubuntu 24.04 x64)'], ['android', 'Kotlin tests + Android build'], ['ios', 'Swift tests + iOS build']]) {
    assert.equal(workflow.jobs[job]?.name, expected, `ci.yml: protected ${job} check name changed`);
  }
}

export function checkRepository(root) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replaceAll('\r\n', '\n');
  const workflows = new Map();
  for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
    if (/\.ya?ml$/.test(file)) workflows.set(file, validateWorkflow(file, read(`.github/workflows/${file}`)));
  }
  for (const file of [...upstreamOnly, 'docker.yml', 'sync-upstream.yml', 'fork-policy.yml']) {
    assert(workflows.has(file), `${file}: required workflow missing`);
  }
  for (const file of ['ci.yml', 'docs.yml']) {
    const triggers = workflows.get(file)?.on;
    assert(triggers?.push?.branches?.includes('main') && triggers.push.branches.includes('develop'), `${file}: main/develop coverage required`);
    assert(Object.hasOwn(triggers, 'workflow_dispatch'), `${file}: manual sync CI dispatch required`);
  }
  validateForkCi(workflows.get('ci.yml'));
  assert(read('README.md').startsWith('# OpenMakiBot\n'), 'README must identify the fork');
  for (const term of ['fork/main', 'fork/develop', 'origin/main', 'codex/pr/', 'codex/sync/', 'docs/verification/README.md']) {
    assert(read('AGENTS.md').includes(term), `AGENTS.md: missing ${term}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRepository(path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url))));
  console.log('OpenMakiBot fork policy passed: identity, branch coverage and publishing boundaries.');
}
