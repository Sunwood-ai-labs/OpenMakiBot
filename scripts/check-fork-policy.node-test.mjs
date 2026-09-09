import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow } from './check-fork-policy.mjs';

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
