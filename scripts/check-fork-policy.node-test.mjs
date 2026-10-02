import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateForkCi, validateWorkflow } from './check-fork-policy.mjs';

const prefix = 'on: {workflow_dispatch: null}\n';
test('rejects workflow-wide write-all in an otherwise new workflow', () => {
  assert.throws(() => validateWorkflow('new.yml', prefix + 'permissions: write-all\njobs:\n  deploy: {runs-on: ubuntu-latest, steps: []}\n'), /repository guard/);
});
test('rejects any writable permission scope, including inline maps', () => {
  for (const scope of ['issues', 'actions', 'checks', 'statuses', 'deployments', 'packages', 'contents', 'id-token']) {
    assert.throws(() => validateWorkflow('new.yml', prefix + `jobs:\n  deploy:\n    permissions: {${scope}: write}\n    runs-on: ubuntu-latest\n    steps: []\n`), /repository guard/);
  }
});
test('checks a second Docker publisher independently of the existing publish job', () => {
  assert.throws(() => validateWorkflow('docker.yml', prefix + `jobs:
  publish:
    if: github.repository == 'milind-soni/OpenMausBot'
    permissions: {packages: write}
    runs-on: ubuntu-latest
    steps: []
  another-publisher:
    permissions: {packages: write}
    runs-on: ubuntu-latest
    steps: []
`), /another-publisher: missing repository guard/);
});
test('resolves aliased permissions before checking a job', () => {
  assert.throws(() => validateWorkflow('new.yml', prefix + 'permissions: &privileged {contents: write}\njobs:\n  deploy:\n    permissions: *privileged\n    runs-on: ubuntu-latest\n    steps: []\n'), /repository guard/);
});
test('rejects duplicate conditions instead of accepting the first guard', () => {
  assert.throws(() => validateWorkflow('release.yml', prefix + `jobs:\n  deploy:\n    if: github.repository == 'milind-soni/OpenMausBot'\n    if: true\n    runs-on: ubuntu-latest\n    steps: []\n`), /Map keys must be unique/);
});
test('accepts a read-only job overriding workflow-wide write permissions', () => {
  validateWorkflow('new.yml', prefix + 'permissions: write-all\njobs:\n  check:\n    permissions: {contents: read}\n    runs-on: ubuntu-latest\n    steps: []\n');
});
test('accepts an explicitly guarded publisher and rejects an OR bypass', () => {
  const source = prefix + `jobs:\n  deploy:\n    if: github.repository == 'milind-soni/OpenMausBot'\n    permissions: write-all\n    runs-on: ubuntu-latest\n    steps: []\n`;
  validateWorkflow('new.yml', source);
  assert.throws(() => validateWorkflow('new.yml', source.replace("OpenMausBot'", "OpenMausBot' || true")), /repository guard|bypassed/);
});

test('permits grouped event alternatives only behind the repository guard', () => {
  const source = prefix + `jobs:\n  deploy:\n    if: github.repository == 'milind-soni/OpenMausBot' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')\n    permissions: {contents: write}\n    runs-on: ubuntu-latest\n    steps: []\n`;
  validateWorkflow('new.yml', source);
  assert.throws(() => validateWorkflow('new.yml', source.replace("'workflow_dispatch')", "'workflow_dispatch') || true")), /bypassed/);
  assert.throws(() => validateWorkflow('new.yml', source.replace("'workflow_dispatch')", "'workflow_dispatch'))")), /unbalanced/);
});

test('external credentials require a guard even when GitHub permissions are read-only', () => {
  for (const reference of ['secrets.CLOUDFLARE_API_TOKEN', "secrets['CLOUDFLARE_API_TOKEN']"]) {
    const source = prefix + `permissions: {contents: read}\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: cloudflare/wrangler-action@v3\n        with:\n          apiToken: \${{ ${reference} }}\n          command: deploy\n`;
    assert.throws(() => validateWorkflow('ci.yml', source), /repository guard/);
    validateWorkflow('ci.yml', source.replace('    runs-on:', "    if: github.repository == 'milind-soni/OpenMausBot'\n    runs-on:"));
  }
});

test('the actual fork CI keeps every protected check and tests each platform', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  validateForkCi(workflow);
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const command = workflow.jobs['legacy-platform-checks'].steps[0].run;
    const script = command.match(/^node -e '([\s\S]+)'$/)?.[1];
    assert(script, 'the protected check must execute its CI result gate');
    const check = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, CI_RESULT: result }, timeout: 5000 });
    assert.ifError(check.error);
    assert.equal(check.status, result === 'success' ? 0 : 1, check.stderr);
  }
  const withoutMac = structuredClone(workflow);
  withoutMac.jobs.static.steps.find((step) => step.id === 'fork-scope').run = 'echo vitest_os=["ubuntu-latest","windows-latest"]';
  assert.throws(() => validateForkCi(withoutMac), /must actually run/);
});
