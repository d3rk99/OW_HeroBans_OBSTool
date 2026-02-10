#!/usr/bin/env python3
"""Desktop GUI + local web bridge for OW2 Hero Bans OBS Tool."""

from __future__ import annotations

import json
import sys
import threading
import time
import tkinter as tk
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tkinter import ttk
from typing import Any
from urllib.parse import urlparse

APP_HOST = "127.0.0.1"
APP_PORT = 8765
if getattr(sys, "frozen", False):
    ROOT_DIR = Path(getattr(sys, "_MEIPASS", Path.cwd()))
else:
    ROOT_DIR = Path(__file__).resolve().parent
HEROES_JSON = ROOT_DIR / "data" / "heroes.json"


class SharedState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = self.default_state()

    @staticmethod
    def default_state() -> dict[str, Any]:
        return {
            "team1": {"ban": ""},
            "team2": {"ban": ""},
            "updatedAt": int(time.time() * 1000),
        }

    @staticmethod
    def sanitize(payload: dict[str, Any] | None) -> dict[str, Any]:
        payload = payload or {}
        return {
            "team1": {"ban": str(payload.get("team1", {}).get("ban", "") or "")},
            "team2": {"ban": str(payload.get("team2", {}).get("ban", "") or "")},
            "updatedAt": int(time.time() * 1000),
        }

    def get(self) -> dict[str, Any]:
        with self._lock:
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "updatedAt": self._state["updatedAt"],
            }

    def set(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        with self._lock:
            self._state = self.sanitize(payload)
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "updatedAt": self._state["updatedAt"],
            }


SHARED_STATE = SharedState()


class BridgeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._write_json(200, SHARED_STATE.get())
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/state":
            self._write_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            self._write_json(400, {"error": "Invalid JSON"})
            return

        updated = SHARED_STATE.set(payload)
        self._write_json(200, updated)




class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class ControlGui:
    def __init__(self, root: tk.Tk, heroes: list[str]) -> None:
        self.root = root
        self.heroes = heroes
        self.state = SHARED_STATE.get()

        root.title("OW2 Hero Bans GUI")
        root.geometry("660x300")
        root.minsize(660, 300)

        frame = ttk.Frame(root, padding=16)
        frame.pack(fill="both", expand=True)

        ttk.Label(
            frame,
            text="Overwatch 2 Hero Bans (Desktop Control)",
            font=("Segoe UI", 14, "bold"),
        ).grid(column=0, row=0, columnspan=4, sticky="w", pady=(0, 12))

        ttk.Label(frame, text="Team 1 Ban").grid(column=0, row=1, sticky="w")
        ttk.Label(frame, text="Team 2 Ban").grid(column=2, row=1, sticky="w")

        self.team1_var = tk.StringVar(value=self.state["team1"]["ban"])
        self.team2_var = tk.StringVar(value=self.state["team2"]["ban"])

        self.team1_combo = ttk.Combobox(frame, textvariable=self.team1_var, values=self.heroes)
        self.team2_combo = ttk.Combobox(frame, textvariable=self.team2_var, values=self.heroes)
        self.team1_combo.grid(column=0, row=2, padx=(0, 12), sticky="ew")
        self.team2_combo.grid(column=2, row=2, padx=(0, 12), sticky="ew")

        ttk.Button(frame, text="Clear Team 1", command=lambda: self.team1_var.set("")).grid(
            column=1, row=2, sticky="ew"
        )
        ttk.Button(frame, text="Clear Team 2", command=lambda: self.team2_var.set("")).grid(
            column=3, row=2, sticky="ew"
        )

        ttk.Button(frame, text="Swap Teams", command=self.swap).grid(column=0, row=3, pady=14, sticky="ew")
        ttk.Button(frame, text="Update", command=self.apply_update).grid(column=1, row=3, pady=14, sticky="ew")
        ttk.Button(frame, text="Reset All", command=self.reset_all).grid(column=2, row=3, pady=14, sticky="ew")

        self.status_var = tk.StringVar(
            value=(
                f"Bridge running at http://{APP_HOST}:{APP_PORT} | "
                f"Use {APP_HOST}:{APP_PORT}/team1.html and /team2.html in OBS"
            )
        )
        ttk.Label(frame, textvariable=self.status_var, wraplength=620).grid(
            column=0, row=4, columnspan=4, sticky="w", pady=(8, 4)
        )

        for col in range(4):
            frame.columnconfigure(col, weight=1)

    def _current_payload(self) -> dict[str, Any]:
        return {
            "team1": {"ban": self.team1_var.get().strip()},
            "team2": {"ban": self.team2_var.get().strip()},
        }

    def apply_update(self) -> None:
        SHARED_STATE.set(self._current_payload())
        self.status_var.set(
            f"Updated at {time.strftime('%H:%M:%S')} | http://{APP_HOST}:{APP_PORT}/team1.html and /team2.html"
        )

    def swap(self) -> None:
        t1 = self.team1_var.get()
        self.team1_var.set(self.team2_var.get())
        self.team2_var.set(t1)
        self.apply_update()

    def reset_all(self) -> None:
        self.team1_var.set("")
        self.team2_var.set("")
        self.apply_update()


def load_heroes() -> list[str]:
    if not HEROES_JSON.exists():
        return []
    payload = json.loads(HEROES_JSON.read_text(encoding="utf-8"))
    return [hero.get("name", "") for hero in payload.get("heroes", []) if hero.get("name")]


def start_server(port: int = APP_PORT) -> ThreadingHTTPServer:
    server = ReusableThreadingHTTPServer((APP_HOST, port), BridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    start_server()
    root = tk.Tk()
    gui = ControlGui(root, load_heroes())
    gui.apply_update()
    root.mainloop()


if __name__ == "__main__":
    main()
