#!/usr/bin/env python3
"""Desktop GUI + local web bridge for OW2 Hero Bans OBS Tool."""

from __future__ import annotations

import json
import sys
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tkinter import ttk
from typing import Any, Callable
from urllib.parse import urlparse

from PIL import Image, ImageTk

APP_HOST = "127.0.0.1"
APP_PORT = 8765
MAX_SUGGESTIONS = 20

BG_MAIN = "#050d23"
BG_CARD = "#0d1737"
BG_FIELD = "#08142f"
BORDER_ACCENT = "#1d6ea8"
BORDER_WARN = "#805121"
TXT_PRIMARY = "#e6edf8"
TXT_MUTED = "#98a7c6"
BTN_PRIMARY = "#f5a12a"
BTN_SECONDARY = "#47b8e9"
BTN_DANGER = "#ff5f67"

if getattr(sys, "frozen", False):
    ROOT_DIR = Path(getattr(sys, "_MEIPASS", Path.cwd()))
else:
    ROOT_DIR = Path(__file__).resolve().parent

HEROES_JSON = ROOT_DIR / "data" / "heroes.json"


@dataclass(frozen=True)
class Hero:
    name: str
    image_path: Path | None


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


def normalize(value: str) -> str:
    return value.strip().lower()


class HeroSuggest(tk.Frame):
    def __init__(
        self,
        parent: tk.Misc,
        heroes: list[Hero],
        icon_map: dict[str, ImageTk.PhotoImage],
        on_change: Callable[[str], None],
    ) -> None:
        super().__init__(parent, bg=BG_CARD)
        self.heroes = heroes
        self.icon_map = icon_map
        self.on_change = on_change
        self.var = tk.StringVar()
        self.popup: tk.Toplevel | None = None

        self.entry = tk.Entry(
            self,
            textvariable=self.var,
            bg=BG_FIELD,
            fg=TXT_PRIMARY,
            insertbackground=TXT_PRIMARY,
            relief="flat",
            highlightthickness=1,
            highlightbackground="#2f4c7d",
            highlightcolor=BORDER_ACCENT,
            font=("Segoe UI", 12, "bold"),
        )
        self.entry.pack(fill="x", ipady=8)

        self.entry.bind("<KeyRelease>", self._on_key_release)
        self.entry.bind("<Down>", self._focus_list)
        self.entry.bind("<FocusIn>", lambda _e: self.show_popup())
        self.entry.bind("<Escape>", lambda _e: self.hide_popup())

    def get(self) -> str:
        return self.var.get().strip()

    def set(self, value: str) -> None:
        self.var.set(value)

    def _filtered(self) -> list[Hero]:
        term = normalize(self.get())
        if not term:
            return self.heroes[:MAX_SUGGESTIONS]

        starts = [h for h in self.heroes if normalize(h.name).startswith(term)]
        includes = [h for h in self.heroes if term in normalize(h.name) and h not in starts]
        return (starts + includes)[:MAX_SUGGESTIONS]

    def _on_key_release(self, event: tk.Event[tk.Entry]) -> None:
        if event.keysym in {"Up", "Down", "Return", "Escape"}:
            return
        self.show_popup()
        self.on_change(self.get())

    def _focus_list(self, _event: tk.Event[tk.Entry]) -> str:
        if not self.popup:
            self.show_popup()
        if self.popup and hasattr(self, "tree"):
            children = self.tree.get_children()
            if children:
                self.tree.focus(children[0])
                self.tree.selection_set(children[0])
                self.tree.focus_set()
        return "break"

    def _select_current(self) -> None:
        if not self.popup:
            return
        selection = self.tree.selection()
        if not selection:
            return
        hero_name = self.tree.item(selection[0], "text")
        self.var.set(hero_name)
        self.on_change(hero_name)
        self.hide_popup()

    def hide_popup(self) -> None:
        if self.popup:
            self.popup.destroy()
            self.popup = None

    def show_popup(self) -> None:
        items = self._filtered()
        if not items:
            self.hide_popup()
            return

        if not self.popup:
            self.popup = tk.Toplevel(self)
            self.popup.wm_overrideredirect(True)
            self.popup.configure(bg="#27436b")

            style = ttk.Style(self.popup)
            style.configure("Suggest.Treeview", background=BG_FIELD, foreground=TXT_PRIMARY, rowheight=42, fieldbackground=BG_FIELD)
            style.map("Suggest.Treeview", background=[("selected", "#204e83")])

            self.tree = ttk.Treeview(self.popup, show="tree", style="Suggest.Treeview", selectmode="browse", height=8)
            self.tree.pack(fill="both", expand=True)

            self.tree.bind("<ButtonRelease-1>", lambda _e: self._select_current())
            self.tree.bind("<Return>", lambda _e: self._select_current())
            self.tree.bind("<Escape>", lambda _e: self.hide_popup())
            self.tree.bind("<FocusOut>", lambda _e: self.after(120, self._safe_hide))

        for item in self.tree.get_children():
            self.tree.delete(item)

        for hero in items:
            self.tree.insert("", "end", text=hero.name, image=self.icon_map.get(hero.name, ""))

        x = self.winfo_rootx()
        y = self.winfo_rooty() + self.winfo_height() + 2
        width = self.winfo_width()
        height = min(8, len(items)) * 42 + 4
        self.popup.geometry(f"{width}x{height}+{x}+{y}")
        self.popup.deiconify()

    def _safe_hide(self) -> None:
        focused = self.focus_get()
        if not self.popup:
            return
        if focused in {self.entry, self.tree}:
            return
        self.hide_popup()


class ControlGui:
    def __init__(self, root: tk.Tk, heroes: list[Hero], icon_map: dict[str, ImageTk.PhotoImage]) -> None:
        self.root = root
        self.heroes = heroes
        self.icon_map = icon_map
        self.state = SHARED_STATE.get()

        root.title("OW2 Hero Bans GUI")
        root.geometry("1300x740")
        root.minsize(1100, 640)
        root.configure(bg=BG_MAIN)

        shell = tk.Frame(root, bg=BG_MAIN, padx=16, pady=16)
        shell.pack(fill="both", expand=True)

        header = tk.Frame(shell, bg=BG_CARD, highlightbackground=BORDER_ACCENT, highlightthickness=1, bd=0)
        header.pack(fill="x", pady=(0, 14))
        tk.Label(header, text="Overwatch 2 Hero Bans", bg=BG_CARD, fg=TXT_PRIMARY, font=("Segoe UI", 30, "bold"), padx=20, pady=16).pack(anchor="w")
        tk.Label(
            header,
            text="Select one banned hero for each team, then press Update to publish both overlays in sync.",
            bg=BG_CARD,
            fg=TXT_MUTED,
            font=("Segoe UI", 15),
            padx=20,
            pady=(0, 16),
        ).pack(anchor="w")

        team_row = tk.Frame(shell, bg=BG_MAIN)
        team_row.pack(fill="x", pady=(0, 14))
        team_row.columnconfigure(0, weight=1)
        team_row.columnconfigure(1, weight=1)

        self.team1_var = tk.StringVar(value=self.state["team1"]["ban"])
        self.team2_var = tk.StringVar(value=self.state["team2"]["ban"])

        self.team1_card, self.team1_preview_icon, self.team1_preview_name, self.team1_input = self._build_team_card(
            team_row,
            "Team 1 Ban",
            0,
            self.team1_var,
            "Clear Team 1 Ban",
            self._clear_team1,
        )
        self.team2_card, self.team2_preview_icon, self.team2_preview_name, self.team2_input = self._build_team_card(
            team_row,
            "Team 2 Ban",
            1,
            self.team2_var,
            "Clear Team 2 Ban",
            self._clear_team2,
        )

        action_row = tk.Frame(shell, bg=BG_MAIN)
        action_row.pack(fill="x", pady=(0, 16))
        action_row.columnconfigure(0, weight=1)
        action_row.columnconfigure(1, weight=1)
        action_row.columnconfigure(2, weight=1)

        self._make_button(action_row, "Swap Teams", BTN_SECONDARY, self.swap).grid(row=0, column=0, padx=(0, 8), sticky="ew")
        self._make_button(action_row, "Update", BTN_PRIMARY, self.apply_update).grid(row=0, column=1, padx=(8, 8), sticky="ew")
        self._make_button(action_row, "Reset All", BTN_DANGER, self.reset_all).grid(row=0, column=2, padx=(8, 0), sticky="ew")

        footer = tk.Frame(shell, bg=BG_FIELD, highlightbackground=BORDER_ACCENT, highlightthickness=1, bd=0, padx=20, pady=20)
        footer.pack(fill="x", side="bottom")

        self.status_var = tk.StringVar()
        tk.Label(
            footer,
            textvariable=self.status_var,
            bg=BG_FIELD,
            fg=TXT_MUTED,
            font=("Segoe UI", 14, "bold"),
            wraplength=1160,
            justify="left",
        ).pack(anchor="w")

        self.team1_var.trace_add("write", lambda *_args: self._sync_preview("team1"))
        self.team2_var.trace_add("write", lambda *_args: self._sync_preview("team2"))
        self._sync_preview("team1")
        self._sync_preview("team2")

    def _make_button(self, parent: tk.Misc, text: str, color: str, command: Callable[[], None]) -> tk.Button:
        return tk.Button(
            parent,
            text=text,
            command=command,
            bg=color,
            fg="#0b1a35",
            activebackground=color,
            activeforeground="#0b1a35",
            relief="flat",
            font=("Segoe UI", 22, "bold"),
            padx=8,
            pady=10,
            cursor="hand2",
        )

    def _build_team_card(
        self,
        parent: tk.Misc,
        title: str,
        column: int,
        var: tk.StringVar,
        clear_label: str,
        clear_command: Callable[[], None],
    ) -> tuple[tk.Frame, tk.Label, tk.Label, HeroSuggest]:
        card = tk.Frame(parent, bg=BG_CARD, highlightbackground=BORDER_WARN, highlightthickness=1, bd=0, padx=16, pady=16)
        card.grid(row=0, column=column, padx=(0, 8) if column == 0 else (8, 0), sticky="nsew")

        tk.Label(card, text=title, bg=BG_CARD, fg=TXT_PRIMARY, font=("Segoe UI", 32, "bold")).pack(anchor="w", pady=(0, 10))
        tk.Label(card, text="Hero", bg=BG_CARD, fg=TXT_PRIMARY, font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(0, 6))

        suggest = HeroSuggest(card, self.heroes, self.icon_map, lambda value, target=var: target.set(value))
        suggest.pack(fill="x", pady=(0, 12))
        suggest.set(var.get())

        preview_row = tk.Frame(card, bg=BG_CARD)
        preview_row.pack(fill="x")
        preview_box = tk.Frame(preview_row, bg="#101f44", highlightbackground="#2b4f87", highlightthickness=1, bd=0, padx=10, pady=10)
        preview_box.pack(side="left", fill="x", expand=True)

        icon_label = tk.Label(preview_box, bg="#101f44", width=44, height=44)
        icon_label.pack(side="left")

        meta = tk.Frame(preview_box, bg="#101f44")
        meta.pack(side="left", padx=10)
        tk.Label(meta, text="Current Ban", bg="#101f44", fg=TXT_MUTED, font=("Segoe UI", 12)).pack(anchor="w")
        name_label = tk.Label(meta, text="None", bg="#101f44", fg=TXT_PRIMARY, font=("Segoe UI", 20, "bold"))
        name_label.pack(anchor="w")

        tk.Button(
            preview_row,
            text=clear_label,
            command=clear_command,
            bg=BTN_SECONDARY,
            fg="#08213f",
            activebackground=BTN_SECONDARY,
            activeforeground="#08213f",
            relief="flat",
            font=("Segoe UI", 16, "bold"),
            padx=16,
            pady=16,
            cursor="hand2",
        ).pack(side="left", padx=(12, 0))

        return card, icon_label, name_label, suggest

    def _clear_team1(self) -> None:
        self.team1_var.set("")
        self.team1_input.set("")

    def _clear_team2(self) -> None:
        self.team2_var.set("")
        self.team2_input.set("")

    def _sync_preview(self, team: str) -> None:
        if team == "team1":
            value = self.team1_var.get().strip()
            icon = self.icon_map.get(value)
            self.team1_preview_name.configure(text=value or "None")
            self.team1_preview_icon.configure(image=icon)
            self.team1_preview_icon.image = icon
            if self.team1_input.get() != value:
                self.team1_input.set(value)
            return

        value = self.team2_var.get().strip()
        icon = self.icon_map.get(value)
        self.team2_preview_name.configure(text=value or "None")
        self.team2_preview_icon.configure(image=icon)
        self.team2_preview_icon.image = icon
        if self.team2_input.get() != value:
            self.team2_input.set(value)

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


def load_heroes() -> list[Hero]:
    if not HEROES_JSON.exists():
        return []

    payload = json.loads(HEROES_JSON.read_text(encoding="utf-8"))
    heroes: list[Hero] = []
    for entry in payload.get("heroes", []):
        name = str(entry.get("name", "") or "").strip()
        image = str(entry.get("image", "") or "").strip()
        if not name:
            continue

        cleaned = image.replace("../", "")
        image_path = ROOT_DIR / "assets" / cleaned if cleaned else None
        heroes.append(Hero(name=name, image_path=image_path if image_path and image_path.exists() else None))

    return heroes


def load_icon_map(heroes: list[Hero]) -> dict[str, ImageTk.PhotoImage]:
    icon_map: dict[str, ImageTk.PhotoImage] = {}
    for hero in heroes:
        if not hero.image_path:
            continue
        try:
            image = Image.open(hero.image_path).convert("RGBA")
            image.thumbnail((56, 56), Image.Resampling.LANCZOS)
            icon_map[hero.name] = ImageTk.PhotoImage(image)
        except Exception:
            continue
    return icon_map


def start_server(port: int = APP_PORT) -> ThreadingHTTPServer:
    server = ReusableThreadingHTTPServer((APP_HOST, port), BridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    start_server()
    root = tk.Tk()
    heroes = load_heroes()
    icon_map = load_icon_map(heroes)
    gui = ControlGui(root, heroes, icon_map)
    gui.apply_update()
    root.mainloop()


if __name__ == "__main__":
    main()
