"""OBS Python script that adds the OW2 Hero Bans control panel as a dock.

Usage:
1) Start gui_tool.py (or the EXE) so http://127.0.0.1:8765/control.html is available.
2) In OBS: Tools -> Scripts -> + -> select this file.
3) Enable/reload the script. A dock named "OW2 Hero Bans" appears in View -> Docks.
"""

from __future__ import annotations

import traceback

import obspython as obs

SCRIPT_SETTINGS = {
    "dock_title": "OW2 Hero Bans",
    "dock_url": "http://127.0.0.1:8765/control.html",
    "dock_id": "ow2_hero_bans_dock",
    "debug_logs": False,
}

_dock_widget = None
_qt_widgets = None
_qt_core = None
_qt_web = None


def _log_info(message: str) -> None:
    obs.script_log(obs.LOG_INFO, message)


def _log_debug(message: str) -> None:
    if SCRIPT_SETTINGS["debug_logs"]:
        obs.script_log(obs.LOG_INFO, f"[debug] {message}")


def _log_error(message: str) -> None:
    obs.script_log(obs.LOG_ERROR, message)


def _import_qt_modules() -> bool:
    global _qt_widgets, _qt_core, _qt_web

    if _qt_widgets and _qt_core and _qt_web:
        return True

    try:
        # OBS ships with Qt. WebEngine availability depends on OBS build.
        from PyQt5 import QtCore, QtWidgets, QtWebEngineWidgets

        _qt_core = QtCore
        _qt_widgets = QtWidgets
        _qt_web = QtWebEngineWidgets
        return True
    except Exception:
        _log_error(
            "Unable to import PyQt5 QtWebEngine modules. "
            "Install the OBS Python dependencies for PyQt5/QtWebEngine and reload script."
        )
        _log_debug(traceback.format_exc())
        return False


def _remove_existing_dock() -> None:
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


def _build_dock() -> bool:
    global _dock_widget

    if not _import_qt_modules():
        return False

    try:
        _remove_existing_dock()

        dock = _qt_widgets.QDockWidget(SCRIPT_SETTINGS["dock_title"])
        dock.setObjectName(SCRIPT_SETTINGS["dock_id"])

        view = _qt_web.QWebEngineView(dock)
        view.setUrl(_qt_core.QUrl(SCRIPT_SETTINGS["dock_url"]))
        dock.setWidget(view)

        obs.obs_frontend_add_dock(dock)
        _dock_widget = dock
        _log_info(f"Added dock '{SCRIPT_SETTINGS['dock_title']}' -> {SCRIPT_SETTINGS['dock_url']}")
        return True
    except Exception:
        _log_error("Failed to create OW2 Hero Bans dock")
        _log_debug(traceback.format_exc())
        return False


def script_description() -> str:
    return (
        "Adds the OW2 Hero Bans control page as an OBS dock.\\n\\n"
        "Run gui_tool.py (or OW2HeroBansGUI.exe) first, then set the dock URL "
        "to the control page endpoint."
    )


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "dock_title", "Dock Title", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "dock_id", "Dock ID", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "dock_url", "Dock URL", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_bool(props, "debug_logs", "Debug logs")
    return props


def script_defaults(settings):
    obs.obs_data_set_default_string(settings, "dock_title", SCRIPT_SETTINGS["dock_title"])
    obs.obs_data_set_default_string(settings, "dock_id", SCRIPT_SETTINGS["dock_id"])
    obs.obs_data_set_default_string(settings, "dock_url", SCRIPT_SETTINGS["dock_url"])
    obs.obs_data_set_default_bool(settings, "debug_logs", SCRIPT_SETTINGS["debug_logs"])


def script_update(settings):
    SCRIPT_SETTINGS["dock_title"] = obs.obs_data_get_string(settings, "dock_title") or "OW2 Hero Bans"
    SCRIPT_SETTINGS["dock_id"] = obs.obs_data_get_string(settings, "dock_id") or "ow2_hero_bans_dock"
    SCRIPT_SETTINGS["dock_url"] = (
        obs.obs_data_get_string(settings, "dock_url") or "http://127.0.0.1:8765/control.html"
    )
    SCRIPT_SETTINGS["debug_logs"] = obs.obs_data_get_bool(settings, "debug_logs")

    _build_dock()


def script_load(_settings):
    _build_dock()


def script_unload():
    _remove_existing_dock()
