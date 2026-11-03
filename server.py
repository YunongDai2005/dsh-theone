"""Dependency-free HTTP app; isolated anonymous demo workspaces, no external APIs."""
import hashlib
import hmac
import json
import os
import re
import secrets
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from ledger import Ledger, Problem, export_csv

ROOT = Path(__file__).resolve().parent


def make_server(host="127.0.0.1", port=3068, data_dir=None):
    data = Path(data_dir or os.environ.get("LEDGER_DATA", ROOT / ".data"))
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    secret_path = data / "session.key"
    if not secret_path.exists():
        # File content is never sent to a browser or passed to a worker.
        fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(secrets.token_bytes(32))
    secret = secret_path.read_bytes()
    ledger = Ledger(data / "ledger.sqlite3")
    allowed_hosts = set(os.environ.get("LEDGER_HOSTS", "127.0.0.1,localhost").split(","))
    secure = os.environ.get("LEDGER_SECURE_COOKIE") == "1"

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, fmt, *args):
            # Avoid paths, bodies and session identifiers in routine access logs.
            pass

        def session(self):
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get("Cookie", ""))
                token = cookie["ledger_workspace"].value
                owner, sig = token.split(".")
                valid = re.fullmatch(r"[a-f0-9]{48}", owner) and hmac.compare_digest(sig, hmac.new(secret, owner.encode(), hashlib.sha256).hexdigest())
            except (KeyError, ValueError):
                valid = False
            if valid:
                self.new_cookie = None
                return owner
            owner = secrets.token_hex(24)
            sig = hmac.new(secret, owner.encode(), hashlib.sha256).hexdigest()
            self.new_cookie = f"ledger_workspace={owner}.{sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800" + ("; Secure" if secure else "")
            return owner

        def send(self, status, body, content_type="application/json; charset=utf-8", download=None):
            if not isinstance(body, bytes):
                body = (json.dumps(body) if "json" in content_type else body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if getattr(self, "new_cookie", None):
                self.send_header("Set-Cookie", self.new_cookie)
            if download:
                self.send_header("Content-Disposition", f'attachment; filename="{download}"')
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self, method):
            try:
                authority = self.headers.get("Host", "")
                hostname = urlsplit("//" + authority).hostname
                if hostname not in allowed_hosts:
                    raise Problem("Host is not allowed.", 403)
                path = urlsplit(self.path).path
                owner = self.session()
                if method == "GET":
                    static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css"), "/fixtures/tickets.csv": ("../fixtures/tickets.csv", "text/csv"), "/fixtures/shipments.csv": ("../fixtures/shipments.csv", "text/csv")}
                    if path in static:
                        filename, kind = static[path]
                        return self.send(200, (ROOT / "public" / filename).read_bytes(), kind + "; charset=utf-8")
                    if path == "/api/runs":
                        return self.send(200, {"runs": ledger.list(owner), "mode": "rules_v1", "external_actions": False})
                    match = re.fullmatch(r"/api/runs/([a-f0-9]{32})(?:/(export.json|export.csv))?", path)
                    if match:
                        run_id, export = match.groups()
                        if export:
                            bundle = ledger.export(owner, run_id)
                            return self.send(200, export_csv(bundle) if export.endswith("csv") else bundle, "text/csv; charset=utf-8" if export.endswith("csv") else "application/json; charset=utf-8", f"dispatch-{run_id}.{export.split('.')[-1]}")
                        return self.send(200, ledger.get(owner, run_id))
                    raise Problem("Not found.", 404)
                origin = self.headers.get("Origin", "")
                parsed_origin = urlsplit(origin)
                if parsed_origin.scheme not in {"http", "https"} or parsed_origin.netloc != authority or self.headers.get("Sec-Fetch-Site") == "cross-site":
                    raise Problem("Use this application's own browser page for actions.", 403)
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise Problem("Send JSON.", 415)
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise Problem("Invalid content length.")
                if not 1 <= length <= 350_000:
                    raise Problem("Request must be between 1 and 350000 bytes.", 413)
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise Problem("Expected a JSON object.")
                if path == "/api/runs":
                    return self.send(201, ledger.create(owner, body.get("tickets_csv"), body.get("shipments_csv")))
                match = re.fullmatch(r"/api/runs/([a-f0-9]{32})/(analyze|review|execute)", path)
                if not match:
                    raise Problem("Not found.", 404)
                run_id, action = match.groups()
                args = [owner, run_id, body.get("revision")]
                if action == "review":
                    args += [body.get("ticket_id"), body.get("decision"), body.get("note")]
                return self.send(200, getattr(ledger, action)(*args))
            except Problem as error:
                self.send(error.status, {"error": str(error)})
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send(400, {"error": "Invalid JSON text."})
            except Exception:
                self.send(500, {"error": "The operation could not finish. Reload to inspect its saved state before retrying; handoff creation is atomic and replay-safe."})

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    app = make_server(os.environ.get("LEDGER_BIND", "127.0.0.1"), int(os.environ.get("PORT", "3068")))
    print(f"Dispatch Ledger listening on {app.server_address[0]}:{app.server_address[1]}", flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.server_close()
