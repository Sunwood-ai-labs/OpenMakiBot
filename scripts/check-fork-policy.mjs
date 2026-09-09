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
  assert(!condition.includes('||'), `${file}/${name}: guard must not be bypassed with OR`);
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
      assert.deepEqual(job.permissions ?? workflow.permissions, { contents: 'write', 'pull-requests': 'write', actions: 'write' });
    } else if (privileged || upstreamOnly.includes(file) || (file === 'docker.yml' && name === 'publish')) {
      guarded(file, name, job.if);
    }
  }
  return workflow;
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
  assert(read('README.md').startsWith('# OpenMakiBot\n'), 'README must identify the fork');
  for (const term of ['fork/main', 'fork/develop', 'origin/main', 'codex/pr/', 'codex/sync/', 'docs/verification/README.md']) {
    assert(read('AGENTS.md').includes(term), `AGENTS.md: missing ${term}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRepository(path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url))));
  console.log('OpenMakiBot fork policy passed: identity, branch coverage and publishing boundaries.');
}
