"""OBS Python script that adds the OW2 Hero Bans control panel as a dock.

Usage:
1) In OBS: Tools -> Scripts -> + -> select this file.
2) Enable/reload the script. It starts a local bridge server automatically.
3) A dock named "OW2 Hero Bans" appears in View -> Docks.
"""

# Keep this script compatible with older OBS-bundled Python versions.

import json
import os
import sys
import threading
import time
import traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse

import obspython as obs

SCRIPT_SETTINGS = {
    "dock_title": "OW2 Hero Bans",
    "dock_url": "http://127.0.0.1:8765/control.html",
    "dock_id": "ow2_hero_bans_dock",
    "debug_logs": False,
    "auto_start_server": True,
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(SCRIPT_DIR, "assets", "Fonts")
STATE_CACHE_PATH = os.path.join(SCRIPT_DIR, "data", "controller_state_cache.json")
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}


def _humanize_font_name(file_name):
    stem = os.path.splitext(os.path.basename(file_name))[0]
    return (stem.replace("_", " ").replace("-", " ").strip() or "Custom Font")


def _list_font_entries():
    if not os.path.isdir(FONTS_DIR):
        return []

    entries = []
    for root, _dirs, files in os.walk(FONTS_DIR):
        for file_name in sorted(files):
            _, ext = os.path.splitext(file_name)
            if ext.lower() not in FONT_EXTENSIONS:
                continue
            full_path = os.path.join(root, file_name)
            rel_path = os.path.relpath(full_path, SCRIPT_DIR).replace("\\", "/")
            entries.append({
                "id": "file:{0}".format(rel_path),
                "path": rel_path,
                "label": _humanize_font_name(file_name),
            })
    return entries

_dock_widget = None
_qt_widgets = None
_qt_core = None
_qt_web = None
_qt_backend_name = None
_qt_import_error_logged = False
_last_applied_signature = None

_bridge_server = None
_bridge_thread = None
_bridge_server_started_by_script = False
_bridge_bind_target = None


def _sanitize_score(value):
    try:
        numeric = int(float(value))
    except Exception:
        return 0
    return numeric if numeric >= 0 else 0


def _sanitize_logo_scale(value):
    try:
        numeric = int(round(float(value)))
    except Exception:
        return 0

    if numeric < -50:
        return -50
    if numeric > 50:
        return 50
    return numeric


class _BridgeState(object):
    def __init__(self):
        self._lock = threading.Lock()
        self._state = self.default_state()
        self._load_cache()

    @staticmethod
    def default_state():
        return {
            "team1": {"ban": ""},
            "team2": {"ban": ""},
            "scoreboard": {
                "team1": {"name": "", "logo": "", "logoScale": 0, "score": 0, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity"},
                "team2": {"name": "", "logo": "", "logoScale": 0, "score": 0, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity"},
            },
            "updatedAt": int(time.time() * 1000),
        }

    @staticmethod
    def sanitize(payload):
        payload = payload or {}
        team1 = payload.get("team1", {}) or {}
        team2 = payload.get("team2", {}) or {}
        scoreboard = payload.get("scoreboard", {}) or {}
        sb_team1 = scoreboard.get("team1", {}) or {}
        sb_team2 = scoreboard.get("team2", {}) or {}
        return {
            "team1": {"ban": str(team1.get("ban", "") or "")},
            "team2": {"ban": str(team2.get("ban", "") or "")},
            "scoreboard": {
                "team1": {
                    "name": str(sb_team1.get("name", "") or ""),
                    "logo": str(sb_team1.get("logo", "") or ""),
                    "logoScale": _sanitize_logo_scale(sb_team1.get("logoScale", 0)),
                    "score": _sanitize_score(sb_team1.get("score", 0)),
                    "nameColor": str(sb_team1.get("nameColor", "#e9eefc") or "#e9eefc"),
                    "bevelColor": str(sb_team1.get("bevelColor", "#7dd3fc") or "#7dd3fc"),
                    "nameFont": str(sb_team1.get("nameFont", "varsity") or "varsity"),
                },
                "team2": {
                    "name": str(sb_team2.get("name", "") or ""),
                    "logo": str(sb_team2.get("logo", "") or ""),
                    "logoScale": _sanitize_logo_scale(sb_team2.get("logoScale", 0)),
                    "score": _sanitize_score(sb_team2.get("score", 0)),
                    "nameColor": str(sb_team2.get("nameColor", "#e9eefc") or "#e9eefc"),
                    "bevelColor": str(sb_team2.get("bevelColor", "#7dd3fc") or "#7dd3fc"),
                    "nameFont": str(sb_team2.get("nameFont", "varsity") or "varsity"),
                },
            },
            "updatedAt": int(time.time() * 1000),
        }


    def _load_cache(self):
        try:
            if not os.path.isfile(STATE_CACHE_PATH):
                return
            with open(STATE_CACHE_PATH, "r") as cache_file:
                payload = json.load(cache_file)
            self._state = self.sanitize(payload)
        except Exception:
            # Best-effort cache load; fall back to defaults on any error.
            self._state = self.default_state()

    def _save_cache(self):
        try:
            cache_dir = os.path.dirname(STATE_CACHE_PATH)
            if cache_dir and not os.path.isdir(cache_dir):
                os.makedirs(cache_dir)
            with open(STATE_CACHE_PATH, "w") as cache_file:
                json.dump(self._state, cache_file, indent=2)
        except Exception:
            # Cache persistence is optional; never block controller updates.
            return

    def get(self):
        with self._lock:
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "scoreboard": {
                    "team1": {
                        "name": self._state["scoreboard"]["team1"]["name"],
                        "logo": self._state["scoreboard"]["team1"]["logo"],
                        "logoScale": self._state["scoreboard"]["team1"].get("logoScale", 0),
                        "score": self._state["scoreboard"]["team1"]["score"],
                        "nameColor": self._state["scoreboard"]["team1"]["nameColor"],
                        "bevelColor": self._state["scoreboard"]["team1"]["bevelColor"],
                        "nameFont": self._state["scoreboard"]["team1"]["nameFont"],
                    },
                    "team2": {
                        "name": self._state["scoreboard"]["team2"]["name"],
                        "logo": self._state["scoreboard"]["team2"]["logo"],
                        "logoScale": self._state["scoreboard"]["team2"].get("logoScale", 0),
                        "score": self._state["scoreboard"]["team2"]["score"],
                        "nameColor": self._state["scoreboard"]["team2"]["nameColor"],
                        "bevelColor": self._state["scoreboard"]["team2"]["bevelColor"],
                        "nameFont": self._state["scoreboard"]["team2"]["nameFont"],
                    },
                },
                "updatedAt": self._state["updatedAt"],
            }

    def set(self, payload):
        with self._lock:
            self._state = self.sanitize(payload)
            self._save_cache()
            return {
                "team1": {"ban": self._state["team1"]["ban"]},
                "team2": {"ban": self._state["team2"]["ban"]},
                "scoreboard": {
                    "team1": {
                        "name": self._state["scoreboard"]["team1"]["name"],
                        "logo": self._state["scoreboard"]["team1"]["logo"],
                        "logoScale": self._state["scoreboard"]["team1"].get("logoScale", 0),
                        "score": self._state["scoreboard"]["team1"]["score"],
                        "nameColor": self._state["scoreboard"]["team1"]["nameColor"],
                        "bevelColor": self._state["scoreboard"]["team1"]["bevelColor"],
                        "nameFont": self._state["scoreboard"]["team1"]["nameFont"],
                    },
                    "team2": {
                        "name": self._state["scoreboard"]["team2"]["name"],
                        "logo": self._state["scoreboard"]["team2"]["logo"],
                        "logoScale": self._state["scoreboard"]["team2"].get("logoScale", 0),
                        "score": self._state["scoreboard"]["team2"]["score"],
                        "nameColor": self._state["scoreboard"]["team2"]["nameColor"],
                        "bevelColor": self._state["scoreboard"]["team2"]["bevelColor"],
                        "nameFont": self._state["scoreboard"]["team2"]["nameFont"],
                    },
                },
                "updatedAt": self._state["updatedAt"],
            }


_BRIDGE_STATE = _BridgeState()


def _log_info(message):
    obs.script_log(obs.LOG_INFO, message)


def _log_debug(message):
    if SCRIPT_SETTINGS["debug_logs"]:
        obs.script_log(obs.LOG_INFO, "[debug] {0}".format(message))


def _log_error(message):
    obs.script_log(obs.LOG_ERROR, message)


class _BridgeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Do not pass "directory" kwarg for Python 3.6 compatibility.
        SimpleHTTPRequestHandler.__init__(self, *args, **kwargs)

    def translate_path(self, path):
        # Mirror SimpleHTTPRequestHandler logic but force script directory root.
        path = path.split("?", 1)[0]
        path = path.split("#", 1)[0]
        parts = [p for p in path.split("/") if p and p not in (".", "..")]
        rooted = SCRIPT_DIR
        for part in parts:
            rooted = os.path.join(rooted, part)
        return rooted

    def log_message(self, _format, *args):
        # OBS scripting logs should stay in obs.script_log only.
        return

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        SimpleHTTPRequestHandler.end_headers(self)

    def _write_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._write_json(200, _BRIDGE_STATE.get())
            return
        if parsed.path == "/api/fonts":
            self._write_json(200, {"fonts": _list_font_entries()})
            return
        SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/state":
            self._write_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)

        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self._write_json(400, {"error": "Invalid JSON"})
            return

        self._write_json(200, _BRIDGE_STATE.set(payload))


class _ReusableThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def _extract_host_port(url_text):
    parsed = urlparse(url_text)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8765
    return host, port


def _ensure_bridge_server_running():
    global _bridge_server, _bridge_thread, _bridge_server_started_by_script, _bridge_bind_target

    if not SCRIPT_SETTINGS["auto_start_server"]:
        _stop_bridge_server_if_owned()
        return

    host, port = _extract_host_port(SCRIPT_SETTINGS["dock_url"])

    if _bridge_server is not None:
        if _bridge_bind_target == (host, port):
            return
        _stop_bridge_server_if_owned()

    try:
        server = _ReusableThreadingHTTPServer((host, port), _BridgeHandler)
    except OSError as exc:
        _log_info(
            "Bridge server not started by script ({0}:{1} unavailable: {2}). "
            "If another instance is running, this is expected.".format(host, port, exc)
        )
        _bridge_server_started_by_script = False
        _bridge_bind_target = None
        return
    except Exception:
        _log_error("Failed to create headless bridge server")
        _log_debug(traceback.format_exc())
        return

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _bridge_server = server
    _bridge_thread = thread
    _bridge_server_started_by_script = True
    _bridge_bind_target = (host, port)
    _log_info("Started headless bridge server at http://{0}:{1}".format(host, port))


def _stop_bridge_server_if_owned():
    global _bridge_server, _bridge_thread, _bridge_server_started_by_script, _bridge_bind_target

    if not _bridge_server_started_by_script:
        return

    if _bridge_server is None:
        return

    try:
        _bridge_server.shutdown()
        _bridge_server.server_close()
    except Exception:
        _log_debug("Failed to stop bridge server cleanly")
        _log_debug(traceback.format_exc())
    finally:
        _bridge_server = None
        _bridge_thread = None
        _bridge_server_started_by_script = False
        _bridge_bind_target = None
        _log_info("Stopped headless bridge server")


def _qt_candidates_for_runtime():
    """Return Qt bindings to probe in priority order for this Python runtime."""

    # Python 3.6 is common in older OBS scripting setups and cannot use Qt6 wheels.
    if sys.version_info < (3, 7):
        return [
            ("PyQt5", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
            ("PySide2", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ]

    return [
        ("PyQt6", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PySide6", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PyQt5", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PySide2", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
    ]


def _import_qt_modules():
    """Load any available Qt binding with WebEngine support.

    If unavailable, we log actionable guidance including an OBS-native fallback
    (Custom Browser Docks) that does not require Python Qt packages.
    """

    global _qt_widgets, _qt_core, _qt_web, _qt_backend_name, _qt_import_error_logged

    if _qt_widgets and _qt_core and _qt_web:
        return True

    candidates = _qt_candidates_for_runtime()

    for binding_name, core_mod, widgets_mod, web_mod in candidates:
        try:
            pkg = __import__(binding_name, fromlist=[core_mod, widgets_mod, web_mod])
            _qt_core = getattr(pkg, core_mod)
            _qt_widgets = getattr(pkg, widgets_mod)
            _qt_web = getattr(pkg, web_mod)
            _qt_backend_name = binding_name
            _log_info("Using Qt backend: {0}".format(binding_name))
            _qt_import_error_logged = False
            return True
        except Exception as exc:
            _log_debug("Qt backend import failed: {0} ({1})".format(binding_name, exc))

    if not _qt_import_error_logged:
        backend_names = ", ".join([name for name, _, _, _ in candidates])
        _log_error(
            "Unable to import a Qt WebEngine backend (tried {0}). "
            "Install one of these in the OBS Python environment and reload script.".format(backend_names)
        )
        _log_error(
            "OBS Python runtime: {0}.{1} at {2}".format(
                sys.version_info[0], sys.version_info[1], sys.executable
            )
        )
        if sys.version_info < (3, 7):
            _log_error(
                "Detected Python 3.6. Use PyQt5/PySide2 + QtWebEngine packages (Qt6 is unsupported on Python 3.6)."
            )
        _log_error(
            "No Python Qt available? Use OBS fallback: View -> Docks -> Custom Browser Docks and add URL "
            "http://127.0.0.1:8765/control.html"
        )
        _qt_import_error_logged = True

    return False


def _build_cache_busted_url(raw_url):
    separator = "&" if "?" in raw_url else "?"
    return "{0}{1}_obsv={2}".format(raw_url, separator, int(time.time() * 1000))


def _remove_existing_dock():
    global _dock_widget

    if _dock_widget is None:
        return

    try:
        obs.obs_frontend_remove_dock(_dock_widget)
        _dock_widget.deleteLater()
    except Exception:
        _log_debug("Failed to remove existing dock cleanly")
        _log_debug(traceback.format_exc())
    finally:
        _dock_widget = None


def _build_dock():
    global _dock_widget

    if not _import_qt_modules():
        return False

    try:
        _remove_existing_dock()

        dock = _qt_widgets.QDockWidget(SCRIPT_SETTINGS["dock_title"])
        dock.setObjectName(SCRIPT_SETTINGS["dock_id"])

        view = _qt_web.QWebEngineView(dock)

        try:
            page = view.page()
            profile = page.profile() if page is not None else None
            cache_enum = getattr(_qt_web, "QWebEngineProfile", None)
            if profile is not None and cache_enum is not None and hasattr(cache_enum, "NoCache"):
                profile.setHttpCacheType(cache_enum.NoCache)
                profile.clearHttpCache()
        except Exception:
            _log_debug("Unable to disable QWebEngine cache for dock view")
            _log_debug(traceback.format_exc())

        dock_url = _build_cache_busted_url(SCRIPT_SETTINGS["dock_url"])
        view.setUrl(_qt_core.QUrl(dock_url))
        dock.setWidget(view)

        obs.obs_frontend_add_dock(dock)
        _dock_widget = dock
        _log_info(
            "Added dock '{0}' -> {1}".format(
                SCRIPT_SETTINGS["dock_title"], SCRIPT_SETTINGS["dock_url"]
            )
        )
        return True
    except Exception:
        _log_error("Failed to create OW2 Hero Bans dock")
        _log_debug(traceback.format_exc())
        return False


def _apply_settings(settings):
    SCRIPT_SETTINGS["dock_title"] = (
        obs.obs_data_get_string(settings, "dock_title") or "OW2 Hero Bans"
    )
    SCRIPT_SETTINGS["dock_id"] = (
        obs.obs_data_get_string(settings, "dock_id") or "ow2_hero_bans_dock"
    )
    SCRIPT_SETTINGS["dock_url"] = (
        obs.obs_data_get_string(settings, "dock_url") or "http://127.0.0.1:8765/control.html"
    )
    SCRIPT_SETTINGS["debug_logs"] = obs.obs_data_get_bool(settings, "debug_logs")
    SCRIPT_SETTINGS["auto_start_server"] = obs.obs_data_get_bool(settings, "auto_start_server")


def _current_signature():
    return (
        SCRIPT_SETTINGS["dock_title"],
        SCRIPT_SETTINGS["dock_id"],
        SCRIPT_SETTINGS["dock_url"],
        SCRIPT_SETTINGS["auto_start_server"],
    )


def script_description():
    return (
        "Adds the OW2 Hero Bans control page as an OBS dock.\n\n"
        "By default this script also starts a local headless web bridge server "
        "for control.html/team1.html/team2.html and stops it when OBS unloads the script."
    )


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "dock_title", "Dock Title", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "dock_id", "Dock ID", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "dock_url", "Dock URL", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_bool(props, "auto_start_server", "Auto-start local headless server")
    obs.obs_properties_add_bool(props, "debug_logs", "Debug logs")
    return props


def script_defaults(settings):
    obs.obs_data_set_default_string(settings, "dock_title", SCRIPT_SETTINGS["dock_title"])
    obs.obs_data_set_default_string(settings, "dock_id", SCRIPT_SETTINGS["dock_id"])
    obs.obs_data_set_default_string(settings, "dock_url", SCRIPT_SETTINGS["dock_url"])
    obs.obs_data_set_default_bool(settings, "auto_start_server", SCRIPT_SETTINGS["auto_start_server"])
    obs.obs_data_set_default_bool(settings, "debug_logs", SCRIPT_SETTINGS["debug_logs"])


def script_update(settings):
    global _last_applied_signature

    _apply_settings(settings)
    _ensure_bridge_server_running()

    signature = _current_signature()

    if signature == _last_applied_signature and _dock_widget is not None:
        _log_debug("Settings unchanged; skipping dock rebuild")
        return

    _build_dock()
    _last_applied_signature = signature


def script_load(_settings):
    # script_update is called by OBS with persisted/default settings.
    pass


def script_unload():
    _remove_existing_dock()
    _stop_bridge_server_if_owned()
