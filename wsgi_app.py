import json
import mimetypes
import os
from urllib.parse import parse_qs

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
USERS = set(db.USERS)

db.init_db()


def _json_response(start_response, obj, status="200 OK"):
    body = json.dumps(obj).encode("utf-8")
    start_response(
        status,
        [("Content-Type", "application/json"), ("Content-Length", str(len(body)))],
    )
    return [body]


def _static_response(start_response, path):
    if path in ("", "/"):
        path = "/index.html"
    file_path = os.path.abspath(os.path.join(PUBLIC_DIR, path.lstrip("/")))
    if not file_path.startswith(os.path.abspath(PUBLIC_DIR)) or not os.path.isfile(file_path):
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Not Found"]
    ctype, _ = mimetypes.guess_type(file_path)
    with open(file_path, "rb") as f:
        body = f.read()
    start_response(
        "200 OK",
        [("Content-Type", ctype or "application/octet-stream"), ("Content-Length", str(len(body)))],
    )
    return [body]


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "/")
    query = environ.get("QUERY_STRING", "")

    if method == "GET" and path == "/api/state":
        user = (parse_qs(query).get("user") or [""])[0]
        if user not in USERS:
            return _json_response(start_response, {"error": "invalid user"}, "400 Bad Request")
        return _json_response(start_response, db.get_state(user))

    if method == "GET" and path == "/api/results":
        return _json_response(start_response, db.get_results())

    if method == "POST" and path in ("/api/vote", "/api/undo"):
        try:
            length = int(environ.get("CONTENT_LENGTH", 0) or 0)
        except ValueError:
            length = 0
        raw = environ["wsgi.input"].read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return _json_response(start_response, {"error": "bad json"}, "400 Bad Request")

        if path == "/api/vote":
            user = payload.get("user")
            name = payload.get("name")
            liked = payload.get("liked")
            if user not in USERS or not name or liked is None:
                return _json_response(start_response, {"error": "invalid payload"}, "400 Bad Request")
            db.cast_vote(user, name, bool(liked))
            return _json_response(start_response, db.get_state(user))

        if path == "/api/undo":
            user = payload.get("user")
            if user not in USERS:
                return _json_response(start_response, {"error": "invalid user"}, "400 Bad Request")
            db.undo_last(user)
            return _json_response(start_response, db.get_state(user))

    if method == "GET":
        return _static_response(start_response, path)

    start_response("404 Not Found", [("Content-Type", "text/plain")])
    return [b"Not Found"]


if __name__ == "__main__":
    from wsgiref.simple_server import make_server

    port = int(os.environ.get("PORT", 8421))
    with make_server("", port, application) as httpd:
        print(f"WSGI app running at http://localhost:{port}")
        httpd.serve_forever()
