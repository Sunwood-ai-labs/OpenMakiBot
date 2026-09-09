import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url)));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replaceAll('\r\n', '\n');
const upstreamOnly = ['release.yml', 'prepare-release.yml', 'npm-package.yml', 'sync-published-release.yml', 'contributors.yml'];
const guard = "github.repository == 'milind-soni/OpenMausBot'";

// Intentionally requires the repository's simple block-style job declarations.
// An unrecognized layout fails closed and must be reviewed during upstream sync.
function jobs(file) {
  const source = read(`.github/workflows/${file}`).split(/^jobs:\s*$/m)[1];
  assert(source, `${file}: missing jobs`);
  const entries = [...source.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)];
  assert(entries.length, `${file}: unsupported job layout`);
  return entries.map(([, name, body]) => ({ name, body }));
}
function guarded(file, job) {
  const conditions = [...job.body.matchAll(/^    if: (.+)$/gm)];
  assert.equal(conditions.length, 1, `${file}/${job.name}: expected exactly one job condition`);
  const condition = conditions[0][1];
  assert(condition === guard || condition?.startsWith(`${guard} && `), `${file}/${job.name}: missing upstream publishing guard`);
  assert(!condition.includes('||'), `${file}/${job.name}: guard must not be bypassed with OR`);
}
for (const file of upstreamOnly) for (const job of jobs(file)) guarded(file, job);
const publish = jobs('docker.yml').find((job) => job.name === 'publish');
assert(publish, 'docker.yml: missing publish job');
guarded('docker.yml', publish);

for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
  if (!/\.ya?ml$/.test(file)) continue;
  const source = read(`.github/workflows/${file}`);
  if (/^\s+(contents|packages|id-token): write$/m.test(source)) {
    assert([...upstreamOnly, 'docker.yml', 'sync-upstream.yml'].includes(file), `${file}: review new publishing/write permissions`);
  }
}
for (const file of ['ci.yml', 'docs.yml']) {
  const source = read(`.github/workflows/${file}`);
  assert(source.includes('branches: [main, develop]'), `${file}: main/develop coverage required`);
  assert(source.includes('  workflow_dispatch:'), `${file}: manual sync CI dispatch required`);
}
assert(read('README.md').startsWith('# OpenMakiBot\n'), 'README must identify the fork');
for (const term of ['fork/main', 'fork/develop', 'origin/main', 'codex/pr/', 'codex/sync/', 'docs/verification/README.md']) {
  assert(read('AGENTS.md').includes(term), `AGENTS.md: missing ${term}`);
}
console.log('OpenMakiBot fork policy passed: identity, branch coverage and publishing boundaries.');
