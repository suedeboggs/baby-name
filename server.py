import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
USERS = set(db.USERS)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, msg, status=400):
        self._send_json({"error": msg}, status)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = os.path.abspath(os.path.join(PUBLIC_DIR, path.lstrip("/")))
        if not file_path.startswith(os.path.abspath(PUBLIC_DIR)):
            self.send_error(403)
            return
        if not os.path.isfile(file_path):
            self.send_error(404)
            return
        ctype, _ = mimetypes.guess_type(file_path)
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/api/state":
            user = (qs.get("user") or [""])[0]
            if user not in USERS:
                return self._send_error_json("invalid user", 400)
            return self._send_json(db.get_state(user))

        if parsed.path == "/api/results":
            return self._send_json(db.get_results())

        return self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._send_error_json("bad json", 400)

        if parsed.path == "/api/vote":
            user = payload.get("user")
            name = payload.get("name")
            status = payload.get("status")
            if user not in USERS or not name or status not in db.STATUSES:
                return self._send_error_json("invalid payload", 400)
            db.cast_vote(user, name, status)
            return self._send_json(db.get_state(user))

        if parsed.path == "/api/undo":
            user = payload.get("user")
            if user not in USERS:
                return self._send_error_json("invalid user", 400)
            db.undo_last(user)
            return self._send_json(db.get_state(user))

        if parsed.path == "/api/add-name":
            user = payload.get("user")
            name = payload.get("name")
            if user not in USERS or not name or not str(name).strip():
                return self._send_error_json("invalid payload", 400)
            db.add_custom_name(user, str(name))
            return self._send_json(db.get_state(user))

        return self._send_error_json("not found", 404)

    def log_message(self, format, *args):
        pass


def main():
    db.init_db()
    port = int(os.environ.get("PORT", 8420))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Baby Names app running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
