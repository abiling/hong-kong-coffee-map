#!/usr/bin/env python3
"""Build a standalone Cloudflare Pages staging upload from the static app."""
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ASSETS = (
    'index.html', 'manifest.webmanifest', 'sw.js',
    'app.js', 'admin-core.js', 'compact-search.js', 'multicity.js',
    'location-catalog.js', 'map-config.js',
    'fonts.css', 'styles.css', 'admin.css', 'filter-scroll.css',
    'compact-nav.css', 'city-list-fix.css', 'dynamic-location.css',
    'icons/mark-cafe-shops.svg', 'icons/icon-180.png', 'icons/icon-192.png',
    'icons/icon-512.png',
)
API_FILES = {'app.js': 'API_URL', 'admin-core.js': 'API_URL', 'multicity.js': 'API_MARKER'}
STORAGE_KEYS = (
    'hk-coffee-admin-key-v2', 'coffee-map-active-city-v1', 'coffee-map-active-country-v1',
    'coffee-map-country-city-v1:', 'coffee-map-all-data-v3', 'coffee-map-all-data-v4',
)
STATIC_REF = re.compile(r"""['"](\./[^'"]+\.(?:js|css|html|webmanifest|svg|png)(?:\?[^'"]*)?)['"]""")


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        if tag in {'link', 'script', 'img', 'use'}:
            self.refs.extend(value for name, value in attrs if name in {'src', 'href'} and value)


def read_source(source_dir, commit):
    if not commit:
        return {name: (source_dir / name).read_bytes() for name in ASSETS}
    if not re.fullmatch(r'[0-9a-fA-F]{40}', commit):
        raise ValueError('--commit requires a full 40-character Git commit SHA')
    return {
        name: subprocess.run(
            ['git', '-C', str(source_dir), 'show', f'{commit}:{name}'],
            check=True, capture_output=True,
        ).stdout for name in ASSETS
    }


def api_declaration(name):
    return re.compile(rf"(\bconst {name} = ')([^']+)(')")


def configure(files, endpoint):
    url = urlsplit(endpoint)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or not re.fullmatch(r'https://[a-z0-9.:-]+/[A-Za-z0-9_./~%-]*', endpoint)
            or any(part in {'.', '..'} for part in url.path.split('/'))):
        raise ValueError('--api-url must be a canonical HTTPS URL with a path and no query or credentials')

    sources = {name: data.decode('utf-8') for name, data in files.items() if not name.endswith('.png')}
    production_match = api_declaration('API_URL').search(sources['app.js'])
    if not production_match:
        raise ValueError('Missing production API declaration in app.js')
    production = production_match[2]
    if not production.startswith('https://script.google.com/') or endpoint == production:
        raise ValueError('Provide a staging endpoint distinct from the production Apps Script URL')
    namespace = 'staging-' + hashlib.sha256(endpoint.encode()).hexdigest()[:12] + '-'

    for name, value in sources.items():
        if name in API_FILES:
            declaration = api_declaration(API_FILES[name])
            found = declaration.findall(value)
            if len(found) != 1 or found[0][1] != production:
                raise ValueError(f'{name}: unexpected API configuration')
            value = declaration.sub(lambda match: match[1] + endpoint + match[3], value)
        # Fail if another copy of the production address or an unreviewed Apps Script
        # endpoint is present anywhere in the packaged runtime, including search.
        if urlsplit(production).path in value or 'script.google.com/' in value.replace(endpoint, ''):
            raise ValueError(f'{name}: unexpected Apps Script reference')
        for key in STORAGE_KEYS:
            value = value.replace(f"'{key}'", f"'{namespace}{key}'")
        for match in re.finditer(r"""['"]((?:coffee-map-(?:active-|country-city-|all-data-|v(?:[0-9]|(?=['"])))|hk-coffee-admin-)[^'"]*)['"]""", value):
            if not (name == 'sw.js' and match[1].startswith('coffee-map-v')):
                raise ValueError(f'{name}: storage key outside the staging namespace: {match[1]}')
        sources[name] = value

    sources['sw.js'] = sources['sw.js'].replace("'coffee-map-v", f"'{namespace}coffee-map-v")
    page = sources['index.html']
    for original, staging in (
        ('<title>Coffee Shops</title>', '<title>Coffee Shops · Staging</title>'),
        ('content="Coffee Shops"', 'content="Coffee Shops · Staging"'),
        ('data-country-label>Coffee Shops</span>', 'data-country-label>Coffee Shops · Staging</span>'),
        ('alt="Cafe Shops" />', 'alt="Cafe Shops" />\n          <span class="staging-label">Staging</span>'),
    ):
        if page.count(original) != 1:
            raise ValueError(f'Missing or ambiguous page label: {original}')
        page = page.replace(original, staging)
    sources['index.html'] = page
    sources['dynamic-location.css'] += '\n.staging-label { font-size: 12px; color: var(--muted); }\n'
    manifest = json.loads(sources['manifest.webmanifest'])
    manifest['name'] += ' · Staging'
    manifest['short_name'] += ' Staging'
    manifest['id'] = './?' + namespace.rstrip('-')
    sources['manifest.webmanifest'] = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    return {**files, **{name: value.encode('utf-8') for name, value in sources.items()}}


def validate_zip(path, expected):
    with ZipFile(path) as archive:
        if archive.namelist() != sorted(expected) or archive.testzip() is not None:
            raise ValueError('Invalid ZIP structure or checksum')
        for name in archive.namelist():
            if archive.read(name) != expected[name]:
                raise ValueError(f'Invalid ZIP contents: {name}')

    page = PageAssets()
    page.feed(expected['index.html'].decode())
    manifest = json.loads(expected['manifest.webmanifest'])
    refs = page.refs + [icon['src'] for icon in manifest['icons']]
    for name in ASSETS:
        if name.endswith('.js'):
            refs.extend(STATIC_REF.findall(expected[name].decode()))
        if name.endswith('.css'):
            refs.extend(match.strip(" '\"") for match in re.findall(r"url\(([^)]+)\)", expected[name].decode()))
    for ref in refs:
        url = urlsplit(ref)
        if url.scheme or url.netloc or not url.path:
            continue
        if str(PurePosixPath(url.path)) not in expected:
            raise ValueError(f'Missing runtime asset: {ref}')
    # Every versioned shell resource must also be requested by the page or its scripts.
    runtime = ''.join(expected[name].decode() for name in ('index.html', 'map-config.js'))
    worker = expected['sw.js'].decode()
    page_versions = {ref for ref in STATIC_REF.findall(runtime) if '?v=' in ref}
    worker_versions = {ref for ref in STATIC_REF.findall(worker) if '?v=' in ref}
    if page_versions != worker_versions:
        mismatches = ', '.join(sorted(page_versions ^ worker_versions))
        raise ValueError(f'Service Worker resource versions do not match the page: {mismatches}')
    if './sw.js?v=' not in expected['app.js'].decode():
        raise ValueError('Missing Service Worker registration')
    cache_keys = re.findall(r"'[^']*coffee-map-all-data-v4'", expected['index.html'].decode())
    if len(cache_keys) != 1 or cache_keys[0] not in expected['location-catalog.js'].decode():
        raise ValueError('Homepage and catalog cache keys differ')


def build(source_dir, commit, endpoint, output):
    if output.suffix.lower() != '.zip' or output.exists():
        raise ValueError('--output must be a new .zip file (no existing file is overwritten)')
    files = configure(read_source(source_dir, commit), endpoint)
    with tempfile.TemporaryDirectory(dir=output.parent) as scratch:
        path = Path(scratch) / 'staging.zip'
        with ZipFile(path, 'w') as archive:
            for name in sorted(files):
                entry = ZipInfo(name)
                archive.writestr(entry, files[name], compress_type=ZIP_DEFLATED)
        validate_zip(path, files)
        # Publish the verified archive only, without replacing an existing path.
        output.hardlink_to(path)
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=Path(__file__).resolve().parent.parent,
                        help='static source directory or Git checkout (default: repository containing the tool)')
    parser.add_argument('--commit', help='build from this full Git SHA instead of reading working-tree files')
    parser.add_argument('--api-url', required=True, help='staging HTTPS API endpoint')
    parser.add_argument('--output', type=Path, required=True, help='new ZIP path')
    args = parser.parse_args()
    try:
        count = build(args.source_dir, args.commit, args.api_url, args.output)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Staging build failed: {error}\n')
    print(f'Staging ZIP verified ({count} files): {args.output}')


if __name__ == '__main__':
    main()
