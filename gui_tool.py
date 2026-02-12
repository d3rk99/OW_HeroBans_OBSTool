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
MAX_SUGGESTIONS = 12

WINDOW_WIDTH = 300
WINDOW_HEIGHT = 450

BG_MAIN = "#050d23"
BG_CARD = "#101a37"
BG_FIELD = "#08142f"
BORDER_ACCENT = "#2c80c4"
BORDER_WARN = "#7f4e1e"
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
STATE_CACHE_PATH = ROOT_DIR / "data" / "controller_state_cache.json"
FONTS_DIR = ROOT_DIR / "assets" / "Fonts"
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}


def _humanize_font_name(path: Path) -> str:
    return path.stem.replace("_", " ").replace("-", " ").strip() or "Custom Font"


def _list_font_entries() -> list[dict[str, str]]:
    if not FONTS_DIR.exists():
        return []

    entries: list[dict[str, str]] = []
    for file_path in sorted(FONTS_DIR.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in FONT_EXTENSIONS:
            continue
        rel_path = file_path.relative_to(ROOT_DIR).as_posix()
        entries.append({
            "id": f"file:{rel_path}",
            "path": rel_path,
            "label": _humanize_font_name(file_path),
        })
    return entries


def _sanitize_score(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except Exception:
        return 0


def _sanitize_logo_scale(value: Any) -> int:
    try:
        numeric = int(round(float(value or 0)))
    except Exception:
        return 0
    return max(-300, min(300, numeric))


def _sanitize_name_display_mode(value: Any) -> str:
    return 'image' if str(value or '').strip().lower() == 'image' else 'text'


def _sanitize_name_scale(value: Any) -> int:
    try:
        numeric = int(round(float(value or 0)))
    except Exception:
        return 0
    return max(-300, min(300, numeric))


@dataclass(frozen=True)
class Hero:
    name: str
    image_path: Path | None


class SharedState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = self.default_state()
        self._load_cache()

    @staticmethod
    def default_state() -> dict[str, Any]:
        return {
            "team1": {"ban": ""},
            "team2": {"ban": ""},
            "scoreboard": {
                "team1": {"name": "", "nameDisplayMode": "text", "nameImageUrl": "", "nameScale": 0, "logo": "", "logoScale": 0, "score": 0, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity"},
                "team2": {"name": "", "nameDisplayMode": "text", "nameImageUrl": "", "nameScale": 0, "logo": "", "logoScale": 0, "score": 0, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity"},
            },
            "updatedAt": int(time.time() * 1000),
        }

    @staticmethod
    def sanitize(payload: dict[str, Any] | None) -> dict[str, Any]:
        payload = payload or {}
        scoreboard = payload.get("scoreboard", {}) or {}
        team1_style = scoreboard.get("team1", {}) or {}
        team2_style = scoreboard.get("team2", {}) or {}
        return {
            "team1": {"ban": str(payload.get("team1", {}).get("ban", "") or "")},
            "team2": {"ban": str(payload.get("team2", {}).get("ban", "") or "")},
            "scoreboard": {
                "team1": {
                    "name": str(team1_style.get("name", "") or ""),
                    "nameDisplayMode": _sanitize_name_display_mode(team1_style.get("nameDisplayMode", "text")),
                    "nameImageUrl": str(team1_style.get("nameImageUrl", "") or ""),
                    "nameScale": _sanitize_name_scale(team1_style.get("nameScale", 0)),
                    "logo": str(team1_style.get("logo", "") or ""),
                    "logoScale": _sanitize_logo_scale(team1_style.get("logoScale", 0)),
                    "score": _sanitize_score(team1_style.get("score", 0)),
                    "nameColor": str(team1_style.get("nameColor", "#e9eefc") or "#e9eefc"),
                    "bevelColor": str(team1_style.get("bevelColor", "#7dd3fc") or "#7dd3fc"),
                    "nameFont": str(team1_style.get("nameFont", "varsity") or "varsity"),
                },
                "team2": {
                    "name": str(team2_style.get("name", "") or ""),
                    "nameDisplayMode": _sanitize_name_display_mode(team2_style.get("nameDisplayMode", "text")),
                    "nameImageUrl": str(team2_style.get("nameImageUrl", "") or ""),
                    "nameScale": _sanitize_name_scale(team2_style.get("nameScale", 0)),
                    "logo": str(team2_style.get("logo", "") or ""),
                    "logoScale": _sanitize_logo_scale(team2_style.get("logoScale", 0)),
                    "score": _sanitize_score(team2_style.get("score", 0)),
                    "nameColor": str(team2_style.get("nameColor", "#e9eefc") or "#e9eefc"),
                    "bevelColor": str(team2_style.get("bevelColor", "#7dd3fc") or "#7dd3fc"),
                    "nameFont": str(team2_style.get("nameFont", "varsity") or "varsity"),
                },
            },
            "updatedAt": int(time.time() * 1000),
        }

    def _load_cache(self) -> None:
        try:
            if not STATE_CACHE_PATH.exists():
                return
            payload = json.loads(STATE_CACHE_PATH.read_text(encoding="utf-8"))
            self._state = self.sanitize(payload)
        except Exception:
            self._state = self.default_state()

    def _save_cache(self) -> None:
        try:
            STATE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            STATE_CACHE_PATH.write_text(json.dumps(self._state, indent=2), encoding="utf-8")
        except Exception:
            return

    def get(self) -> dict[str, Any]:
        with self._lock:
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "scoreboard": self._state["scoreboard"],
                "updatedAt": self._state["updatedAt"],
            }

    def set(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        with self._lock:
            self._state = self.sanitize(payload)
            self._save_cache()
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "scoreboard": self._state["scoreboard"],
                "updatedAt": self._state["updatedAt"],
            }


SHARED_STATE = SharedState()


class BridgeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, _format: str, *args: Any) -> None:
        """Suppress stdlib HTTP stderr logging for windowed EXE builds.

        In PyInstaller/OBS tool workflows without a console, ``sys.stderr`` can be
        ``None`` and the default ``SimpleHTTPRequestHandler.log_message`` may raise,
        causing requests to terminate with an empty response.
        """

        return

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
        if parsed.path == "/api/fonts":
            self._write_json(200, {"fonts": _list_font_entries()})
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


def rounded_polygon_points(x1: int, y1: int, x2: int, y2: int, r: int) -> list[int]:
    return [
        x1 + r,
        y1,
        x2 - r,
        y1,
        x2,
        y1,
        x2,
        y1 + r,
        x2,
        y2 - r,
        x2,
        y2,
        x2 - r,
        y2,
        x1 + r,
        y2,
        x1,
        y2,
        x1,
        y2 - r,
        x1,
        y1 + r,
        x1,
        y1,
    ]


class RoundedPanel(tk.Canvas):
    def __init__(self, master: tk.Misc, bg_color: str, border_color: str, radius: int = 12, padding: int = 8, **kwargs: Any) -> None:
        super().__init__(master, bg=BG_MAIN, highlightthickness=0, bd=0, **kwargs)
        self.bg_color = bg_color
        self.border_color = border_color
        self.radius = radius
        self.padding = padding
        self.inner = tk.Frame(self, bg=bg_color)
        self._shape_id = self.create_polygon(
            1, 1, 2, 1, 2, 2, 1, 2,
            smooth=True,
            fill=bg_color,
            outline=border_color,
            width=1,
        )
        self._win_id = self.create_window((padding, padding), window=self.inner, anchor="nw")
        self.bind("<Configure>", self._on_resize)

    def _on_resize(self, _event: tk.Event[tk.Canvas]) -> None:
        w = max(2, self.winfo_width())
        h = max(2, self.winfo_height())
        r = min(self.radius, w // 2, h // 2)
        points = rounded_polygon_points(1, 1, w - 1, h - 1, r)
        self.coords(self._shape_id, *points)
        self.coords(self._win_id, self.padding, self.padding)
        self.itemconfigure(self._win_id, width=max(1, w - self.padding * 2), height=max(1, h - self.padding * 2))


class HeroSuggest(tk.Frame):
    def __init__(
        self,
        parent: tk.Misc,
        heroes: list[Hero],
        icon_map: dict[str, ImageTk.PhotoImage],
        on_select: Callable[[str], None],
    ) -> None:
        super().__init__(parent, bg=BG_CARD)
        self.heroes = heroes
        self.hero_names = {h.name for h in heroes}
        self.icon_map = icon_map
        self.on_select = on_select

        self.query_var = tk.StringVar()
        self.selected_name = ""
        self.popup: tk.Toplevel | None = None
        self.tree: ttk.Treeview | None = None

        self.entry = tk.Entry(
            self,
            textvariable=self.query_var,
            bg=BG_FIELD,
            fg=TXT_PRIMARY,
            insertbackground=TXT_PRIMARY,
            relief="flat",
            highlightthickness=1,
            highlightbackground="#2f4c7d",
            highlightcolor=BORDER_ACCENT,
            font=("Segoe UI", 10, "bold"),
        )
        self.entry.pack(fill="x", ipady=6)

        self.entry.bind("<KeyRelease>", self._on_key_release)
        self.entry.bind("<Down>", self._focus_list)
        self.entry.bind("<Return>", self._on_enter)
        self.entry.bind("<FocusIn>", lambda _e: self.show_popup())
        self.entry.bind("<FocusOut>", lambda _e: self.after(130, self._enforce_valid_text))
        self.entry.bind("<Escape>", lambda _e: self.hide_popup())

    def get_selected(self) -> str:
        return self.selected_name

    def set_selected(self, value: str) -> None:
        value = value.strip()
        if value in self.hero_names:
            self.selected_name = value
            self.query_var.set(value)
            self.on_select(value)
            return

        self.selected_name = ""
        self.query_var.set("")
        self.on_select("")

    def _filtered(self) -> list[Hero]:
        term = normalize(self.query_var.get())
        if not term:
            return self.heroes[:MAX_SUGGESTIONS]

        starts = [h for h in self.heroes if normalize(h.name).startswith(term)]
        includes = [h for h in self.heroes if term in normalize(h.name) and h not in starts]
        return (starts + includes)[:MAX_SUGGESTIONS]

    def _on_key_release(self, event: tk.Event[tk.Entry]) -> None:
        if event.keysym in {"Up", "Down", "Return", "Escape"}:
            return
        self.show_popup()

    def _focus_list(self, _event: tk.Event[tk.Entry]) -> str:
        self.show_popup()
        if self.tree:
            children = self.tree.get_children()
            if children:
                self.tree.focus(children[0])
                self.tree.selection_set(children[0])
                self.tree.focus_set()
        return "break"

    def _on_enter(self, _event: tk.Event[tk.Entry]) -> str:
        text = self.query_var.get().strip()
        if text in self.hero_names:
            self._apply_selection(text)
        else:
            self.query_var.set(self.selected_name)
            self.hide_popup()
        return "break"

    def _apply_selection(self, hero_name: str) -> None:
        if hero_name not in self.hero_names:
            return
        self.selected_name = hero_name
        self.query_var.set(hero_name)
        self.on_select(hero_name)
        self.hide_popup()
        self.entry.icursor("end")

    def _select_current_tree_item(self) -> None:
        if not self.tree:
            return
        selection = self.tree.selection()
        if not selection:
            return
        hero_name = self.tree.item(selection[0], "text")
        self._apply_selection(hero_name)

    def hide_popup(self) -> None:
        if self.popup:
            self.popup.destroy()
            self.popup = None
            self.tree = None

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
            style.configure(
                "Suggest.Treeview",
                background=BG_FIELD,
                foreground=TXT_PRIMARY,
                rowheight=30,
                fieldbackground=BG_FIELD,
                borderwidth=0,
                font=("Segoe UI", 9),
            )
            style.map("Suggest.Treeview", background=[("selected", "#204e83")])

            self.tree = ttk.Treeview(self.popup, show="tree", style="Suggest.Treeview", selectmode="browse", height=6)
            self.tree.pack(fill="both", expand=True)
            self.tree.bind("<ButtonRelease-1>", lambda _e: self._select_current_tree_item())
            self.tree.bind("<Return>", lambda _e: self._select_current_tree_item())
            self.tree.bind("<Escape>", lambda _e: self.hide_popup())
            self.tree.bind("<FocusOut>", lambda _e: self.after(120, self._safe_hide))

        if not self.tree:
            return

        for item in self.tree.get_children():
            self.tree.delete(item)

        for hero in items:
            self.tree.insert("", "end", text=hero.name, image=self.icon_map.get(hero.name, ""))

        x = self.winfo_rootx()
        y = self.winfo_rooty() + self.winfo_height() + 1
        width = max(120, self.winfo_width())
        height = min(6, len(items)) * 30 + 4
        self.popup.geometry(f"{width}x{height}+{x}+{y}")
        self.popup.deiconify()

    def _safe_hide(self) -> None:
        focused = self.focus_get()
        if not self.popup:
            return
        if focused in {self.entry, self.tree}:
            return
        self.hide_popup()

    def _enforce_valid_text(self) -> None:
        focused = self.focus_get()
        if focused in {self.entry, self.tree}:
            return

        entered = self.query_var.get().strip()
        if entered in self.hero_names:
            self._apply_selection(entered)
            return

        self.query_var.set(self.selected_name)
        self.hide_popup()


class ControlGui:
    def __init__(self, root: tk.Tk, heroes: list[Hero], icon_map: dict[str, ImageTk.PhotoImage]) -> None:
        self.root = root
        self.heroes = heroes
        self.hero_names = {h.name for h in heroes}
        self.icon_map = icon_map
        state = SHARED_STATE.get()

        root.title("OW2 Hero Bans GUI")
        root.geometry(f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}")
        root.minsize(WINDOW_WIDTH, WINDOW_HEIGHT)
        root.maxsize(WINDOW_WIDTH, WINDOW_HEIGHT)
        root.configure(bg=BG_MAIN)

        shell = tk.Frame(root, bg=BG_MAIN, padx=8, pady=8)
        shell.pack(fill="both", expand=True)

        header = RoundedPanel(shell, bg_color=BG_CARD, border_color=BORDER_ACCENT, radius=12, padding=8, height=58)
        header.pack(fill="x", pady=(0, 6))
        tk.Label(header.inner, text="OW2 Hero Bans", bg=BG_CARD, fg=TXT_PRIMARY, font=("Segoe UI", 14, "bold")).pack(anchor="w")
        tk.Label(header.inner, text="GUI control for team bans", bg=BG_CARD, fg=TXT_MUTED, font=("Segoe UI", 8)).pack(anchor="w")

        self.team1_var = tk.StringVar()
        self.team2_var = tk.StringVar()

        self.team1_icon, self.team1_name, self.team1_input = self._build_team_panel(
            shell, "Team 1", self.team1_var, self._clear_team1
        )
        self.team2_icon, self.team2_name, self.team2_input = self._build_team_panel(
            shell, "Team 2", self.team2_var, self._clear_team2
        )

        actions = RoundedPanel(shell, bg_color=BG_CARD, border_color=BORDER_ACCENT, radius=12, padding=6, height=44)
        actions.pack(fill="x", pady=(6, 6))
        for i in range(3):
            actions.inner.columnconfigure(i, weight=1)

        self._make_button(actions.inner, "Swap", BTN_SECONDARY, self.swap).grid(row=0, column=0, padx=3, sticky="ew")
        self._make_button(actions.inner, "Update", BTN_PRIMARY, self.apply_update).grid(row=0, column=1, padx=3, sticky="ew")
        self._make_button(actions.inner, "Reset", BTN_DANGER, self.reset_all).grid(row=0, column=2, padx=3, sticky="ew")

        footer = RoundedPanel(shell, bg_color=BG_FIELD, border_color=BORDER_ACCENT, radius=12, padding=8, height=62)
        footer.pack(fill="x", side="bottom")
        self.status_var = tk.StringVar()
        tk.Label(
            footer.inner,
            textvariable=self.status_var,
            bg=BG_FIELD,
            fg=TXT_MUTED,
            font=("Segoe UI", 7, "bold"),
            wraplength=260,
            justify="left",
        ).pack(anchor="w")

        self.team1_var.trace_add("write", lambda *_args: self._sync_preview("team1"))
        self.team2_var.trace_add("write", lambda *_args: self._sync_preview("team2"))

        self.team1_input.set_selected(state.get("team1", {}).get("ban", ""))
        self.team2_input.set_selected(state.get("team2", {}).get("ban", ""))
        self._sync_preview("team1")
        self._sync_preview("team2")

    def _build_team_panel(
        self,
        parent: tk.Misc,
        title: str,
        target_var: tk.StringVar,
        clear_cmd: Callable[[], None],
    ) -> tuple[tk.Label, tk.Label, HeroSuggest]:
        panel = RoundedPanel(parent, bg_color=BG_CARD, border_color=BORDER_WARN, radius=12, padding=8, height=126)
        panel.pack(fill="x", pady=(0, 6))

        tk.Label(panel.inner, text=f"{title} Ban", bg=BG_CARD, fg=TXT_PRIMARY, font=("Segoe UI", 10, "bold")).pack(anchor="w")
        selector = HeroSuggest(panel.inner, self.heroes, self.icon_map, lambda value, v=target_var: v.set(value))
        selector.pack(fill="x", pady=(3, 5))

        row = tk.Frame(panel.inner, bg=BG_CARD)
        row.pack(fill="x")

        preview = tk.Frame(row, bg="#101f44", highlightbackground="#2b4f87", highlightthickness=1)
        preview.pack(side="left", fill="x", expand=True)

        icon = tk.Label(preview, bg="#101f44", width=24, height=24)
        icon.pack(side="left", padx=(4, 4), pady=4)

        name = tk.Label(preview, text="None", bg="#101f44", fg=TXT_PRIMARY, font=("Segoe UI", 11, "bold"))
        name.pack(side="left", pady=4)

        tk.Button(
            row,
            text="Clear",
            command=clear_cmd,
            bg=BTN_SECONDARY,
            fg="#08213f",
            activebackground=BTN_SECONDARY,
            activeforeground="#08213f",
            relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=8,
            cursor="hand2",
        ).pack(side="left", padx=(5, 0), fill="y")

        return icon, name, selector

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
            font=("Segoe UI", 9, "bold"),
            pady=5,
            cursor="hand2",
        )

    def _clear_team1(self) -> None:
        self.team1_input.set_selected("")

    def _clear_team2(self) -> None:
        self.team2_input.set_selected("")

    def _sync_preview(self, team: str) -> None:
        if team == "team1":
            value = self.team1_var.get().strip()
            if value not in self.hero_names:
                value = ""
            icon = self.icon_map.get(value)
            self.team1_name.configure(text=value or "None")
            self.team1_icon.configure(image=icon)
            self.team1_icon.image = icon
            return

        value = self.team2_var.get().strip()
        if value not in self.hero_names:
            value = ""
        icon = self.icon_map.get(value)
        self.team2_name.configure(text=value or "None")
        self.team2_icon.configure(image=icon)
        self.team2_icon.image = icon

    def _current_payload(self) -> dict[str, Any]:
        team1 = self.team1_input.get_selected()
        team2 = self.team2_input.get_selected()
        return {
            "team1": {"ban": team1 if team1 in self.hero_names else ""},
            "team2": {"ban": team2 if team2 in self.hero_names else ""},
        }

    def apply_update(self) -> None:
        SHARED_STATE.set(self._current_payload())
        self.status_var.set(f"Updated {time.strftime('%H:%M:%S')} | {APP_HOST}:{APP_PORT}/team1.html + /team2.html")

    def swap(self) -> None:
        team1 = self.team1_input.get_selected()
        team2 = self.team2_input.get_selected()
        self.team1_input.set_selected(team2)
        self.team2_input.set_selected(team1)
        self.apply_update()

    def reset_all(self) -> None:
        self.team1_input.set_selected("")
        self.team2_input.set_selected("")
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
        image = Image.open(hero.image_path).convert("RGBA")
        image.thumbnail((24, 24), Image.Resampling.LANCZOS)
        icon_map[hero.name] = ImageTk.PhotoImage(image)
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
