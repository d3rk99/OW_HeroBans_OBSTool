"""OBS Python script that adds the OW2 Hero Bans control panel as a dock.

Usage:
1) Start gui_tool.py (or the EXE) so http://127.0.0.1:8765/control.html is available.
2) In OBS: Tools -> Scripts -> + -> select this file.
3) Enable/reload the script. A dock named "OW2 Hero Bans" appears in View -> Docks.
"""

# Keep this script compatible with older OBS-bundled Python versions.

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
_qt_backend_name = None
_qt_import_error_logged = False
_last_applied_signature = None


def _log_info(message):
    obs.script_log(obs.LOG_INFO, message)


def _log_debug(message):
    if SCRIPT_SETTINGS["debug_logs"]:
        obs.script_log(obs.LOG_INFO, "[debug] {0}".format(message))


def _log_error(message):
    obs.script_log(obs.LOG_ERROR, message)


def _import_qt_modules():
    """Load any available Qt binding with WebEngine support.

    OBS Python environments vary a lot between versions/installations.
    We try common bindings in order and cache the first success.
    """

    global _qt_widgets, _qt_core, _qt_web, _qt_backend_name, _qt_import_error_logged

    if _qt_widgets and _qt_core and _qt_web:
        return True

    candidates = [
        ("PyQt6", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PySide6", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PyQt5", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
        ("PySide2", "QtCore", "QtWidgets", "QtWebEngineWidgets"),
    ]

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
        except Exception:
            _log_debug("Qt backend import failed: {0}".format(binding_name))
            _log_debug(traceback.format_exc())

    if not _qt_import_error_logged:
        _log_error(
            "Unable to import a Qt WebEngine backend (tried PyQt6, PySide6, PyQt5, PySide2). "
            "Install one of these in the OBS Python environment and reload script."
        )
        _qt_import_error_logged = True

    return False


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
        view.setUrl(_qt_core.QUrl(SCRIPT_SETTINGS["dock_url"]))
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


def _current_signature():
    return (
        SCRIPT_SETTINGS["dock_title"],
        SCRIPT_SETTINGS["dock_id"],
        SCRIPT_SETTINGS["dock_url"],
    )


def script_description():
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
    global _last_applied_signature

    _apply_settings(settings)
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
