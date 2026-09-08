"""Local-only before/after instrumented copies; never edits production files.

Run: python3 tools/performance/serve.py
Open: http://127.0.0.1:8765/
Requires Python 3 and git, but no installed packages, hosted service or telemetry.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
import mimetypes
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASELINE = 'd6499e6d14ecb45d6dcdc8620ebaa316d9b90df9'


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = unquote(urlsplit(self.path).path)
        if route == '/':
            file = ROOT / 'tools/performance/index.html'
            body, mime = file.read_bytes(), 'text/html'
        elif route == '/probe.js':
            body = (ROOT / 'tools/performance/probe.js').read_bytes()
            mime = 'text/javascript'
        elif route.startswith(('/before/', '/after/')):
            variant, name = route.strip('/').split('/', 1)
            name = name or 'index.html'
            target = (ROOT / name).resolve()
            if not target.is_relative_to(ROOT) or name == 'sw.js' or any(p.startswith('.') for p in Path(name).parts):
                self.send_error(404)
                return
            try:
                body = (subprocess.check_output(['git', 'show', f'{BASELINE}:{name}'], cwd=ROOT,
                                               stderr=subprocess.DEVNULL)
                        if variant == 'before' else target.read_bytes())
            except (OSError, subprocess.CalledProcessError):
                self.send_error(404)
                return
            mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
            if name == 'index.html':
                text = body.decode()
                # Start instrumentation after the same MapLibre library, before
                # both wrappers and the application. No production script edits.
                needle = '<script src="./map-config.js?'
                text = text.replace(needle, '<script src="/probe.js"></script>\n  ' + needle, 1)
                body = text.encode()
            elif name == 'app.js':
                # Same cache policy for both measured copies. Do not install a SW
                # that could replace instrumented responses with production HTML.
                body = body.replace(b"if ('serviceWorker' in navigator && location.protocol.startsWith('http'))",
                                    b'if (false)')
            elif name == 'multicity.js':
                body = body.replace(b'const storedCity = localStorage.getItem(CITY_STORAGE_KEY);',
                                    b"const storedCity = new URLSearchParams(location.search).get('city') || 'Tokyo';")
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print('Local performance audit: http://127.0.0.1:8765/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
