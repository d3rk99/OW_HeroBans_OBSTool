#!/usr/bin/env python3
import argparse
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

STATE = {
    "team1": {"ban": ""},
    "team2": {"ban": ""},
    "updatedAt": 0,
}


class HeroBansHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") == "/state":
            payload = json.dumps(STATE).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.rstrip("/") != "/state":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON")
            return

        STATE["team1"]["ban"] = data.get("team1", {}).get("ban", "") or ""
        STATE["team2"]["ban"] = data.get("team2", {}).get("ban", "") or ""
        STATE["updatedAt"] = int(data.get("updatedAt", 0))

        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()


def main():
    parser = argparse.ArgumentParser(description="Hero bans local server for OBS docks/overlays.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8787, help="Port to bind (default: 8787)")
    args = parser.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    os.chdir(repo_root)

    server = ThreadingHTTPServer((args.host, args.port), HeroBansHandler)
    print(f"Serving hero bans on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
