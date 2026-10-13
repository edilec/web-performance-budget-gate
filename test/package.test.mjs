import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('GitHub-source package includes the runnable command and library', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.bin, { 'web-performance-budget-gate': 'bin/web-performance-budget-gate.mjs' });

  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_offline: 'true' },
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((file) => file.path);
  for (const path of ['bin/web-performance-budget-gate.mjs', 'src/index.mjs', 'CHANGELOG.md']) {
    assert.ok(files.includes(path), `${path} is missing from the package`);
  }
});
