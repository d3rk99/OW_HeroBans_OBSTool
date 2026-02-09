import os
import subprocess
import sys

import obspython as obs

_process = None
_port = 8787


def _server_path():
    script_dir = os.path.abspath(os.path.dirname(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, os.pardir))
    return os.path.join(repo_root, "server", "ban_server.py")


def _start_server():
    global _process
    if _process is not None and _process.poll() is None:
        return
    server_path = _server_path()
    _process = subprocess.Popen(
        [sys.executable, server_path, "--port", str(_port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop_server():
    global _process
    if _process is None:
        return
    _process.terminate()
    try:
        _process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        _process.kill()
    _process = None


def script_description():
    return (
        "Runs the OW2 Hero Bans local server so dock/control/overlays share state."
    )


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_int(props, "port", "Server Port", 1024, 65535, 1)
    return props


def script_defaults(settings):
    obs.obs_data_set_default_int(settings, "port", 8787)


def script_update(settings):
    global _port
    _port = obs.obs_data_get_int(settings, "port")
    _stop_server()
    _start_server()


def script_load(settings):
    _start_server()


def script_unload():
    _stop_server()
