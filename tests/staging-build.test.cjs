const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const root = join(__dirname, '..');
const builder = join(root, 'tools', 'build_staging.py');
const endpoint = 'https://script.google.com/macros/s/fake-staging-test/exec';
const args = (output, extra = [], api = endpoint) => [builder, '--api-url', api, '--output', output, ...extra];

test('staging ZIP has a reproducible static shell and isolated runtime configuration', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'coffee-staging-test-'));
  try {
    const first = join(scratch, 'first.zip');
    const second = join(scratch, 'second.zip');
    const sourceBefore = readFileSync(join(root, 'app.js'), 'utf8');
    execFileSync('python3', args(first));
    execFileSync('python3', args(second, ['--source-dir', root]));
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.equal(readFileSync(join(root, 'app.js'), 'utf8'), sourceBefore);
    const production = sourceBefore.match(/const API_URL = '([^']+)'/)[1];
    const inspect = `
import json, re, sys, zipfile
from urllib.parse import urlsplit

path, stage, production = sys.argv[1:]
with zipfile.ZipFile(path) as bundle:
    files = bundle.namelist()
    assert 'index.html' in files and len(files) == 20
    assert not any(name.startswith(('.', 'tests/', 'docs/', 'apps-script/', 'tools/')) for name in files)
    read = lambda name: bundle.read(name).decode('utf-8')
    for name in ('app.js', 'admin-core.js', 'multicity.js'):
        assert stage in read(name)
    assert 'script.google.com' not in read('compact-search.js')
    for name in files:
        if name.endswith(('.js', '.html')):
            assert urlsplit(production).path not in read(name)
    page = read('index.html')
    assert '<span class="staging-label">Staging</span>' in page
    assert 'Staging' in json.loads(read('manifest.webmanifest'))['short_name']
    storage = re.search(r"'(staging-[a-f0-9]+-)hk-coffee-admin-key-v2'", read('admin-core.js'))
    prefix = storage[1]
    for name, keys in {
        'app.js': ('hk-coffee-admin-key-v2', 'coffee-map-all-data-v3'),
        'index.html': ('coffee-map-active-city-v1', 'coffee-map-active-country-v1', 'coffee-map-all-data-v4'),
        'location-catalog.js': ('coffee-map-all-data-v4',),
        'multicity.js': ('coffee-map-active-city-v1', 'coffee-map-active-country-v1', 'coffee-map-country-city-v1:'),
        'sw.js': ('coffee-map-v', 'coffee-map-v40'),
    }.items():
        for key in keys:
            assert "'" + prefix + key + "'" in read(name)
            assert "'" + key + "'" not in read(name)
`;
    execFileSync('python3', ['-c', inspect, first, endpoint, production]);
    const overwrite = spawnSync('python3', args(first), { encoding: 'utf8' });
    assert.equal(overwrite.status, 1);
    assert.match(overwrite.stderr, /new \.zip file/);
    const sameAPI = spawnSync('python3', args(join(scratch, 'prod.zip'), [], production), { encoding: 'utf8' });
    assert.equal(sameAPI.status, 1);
    assert.match(sameAPI.stderr, /distinct/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('staging build rejects missing local runtime resources and stray API references', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'coffee-staging-test-'));
  try {
    const source = join(scratch, 'src');
    cpSync(root, source, {
      recursive: true,
      filter: path => path === root || /^(?:[^/]+\.(?:js|css|html|webmanifest)|icons(?:\/.*)?)$/.test(path.slice(root.length + 1))
    });
    const html = join(source, 'index.html');
    const original = readFileSync(html, 'utf8');
    const output = join(scratch, 'invalid.zip');
    writeFileSync(html, original.replace('</head>', '<link rel="stylesheet" href="./missing.css"></head>'));
    const missing = spawnSync('python3', args(output, ['--source-dir', source]), { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing runtime asset/);
    writeFileSync(html, original);
    writeFileSync(join(source, 'compact-search.js'), "const stray = 'https://script.google.com/macros/s/stray/exec';\n");
    const stray = spawnSync('python3', args(output, ['--source-dir', source]), { encoding: 'utf8' });
    assert.equal(stray.status, 1);
    assert.match(stray.stderr, /compact-search.js: unexpected Apps Script reference/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
