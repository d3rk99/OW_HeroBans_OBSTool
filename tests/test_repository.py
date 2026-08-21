import importlib.util
import json
import os
import sys
import tempfile
import threading
import types
import unittest
import urllib.request
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]


def load_module(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GUI = load_module("ow2_gui_tool_test", "gui_tool.py")

OBS_STUB = types.ModuleType("obspython")
with mock.patch.dict(sys.modules, {"obspython": OBS_STUB}):
    OBS_DOCK = load_module("ow2_obs_dock_test", "obs_hero_bans_dock.py")


class StateBridgeTests(unittest.TestCase):
    def exercise_partial_update(self, module, state_class):
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / "state.json"
            replacement = str(cache_path) if isinstance(module.STATE_CACHE_PATH, str) else cache_path
            with mock.patch.object(module, "STATE_CACHE_PATH", replacement):
                state = state_class()
                map_id = module.DEFAULT_VALORANT_MAP_POOL[0]
                state.set({
                    "scoreboard": {"team1": {"name": "Alpha", "score": 2}},
                    "valorantMapPool": [map_id],
                    "logoParticle": {"density": 9},
                })
                result = state.set({"team1": {"ban": "Ana"}})

            self.assertEqual(result["team1"]["ban"], "Ana")
            self.assertEqual(result["scoreboard"]["team1"]["name"], "Alpha")
            self.assertEqual(result["scoreboard"]["team1"]["score"], 2)
            self.assertEqual(result["valorantMapPool"], [map_id])
            self.assertEqual(result["logoParticle"]["density"], 9)

    def test_desktop_bridge_preserves_unrelated_state(self):
        self.exercise_partial_update(GUI, GUI.SharedState)

    def test_obs_bridge_preserves_unrelated_state(self):
        self.exercise_partial_update(OBS_DOCK, OBS_DOCK._BridgeState)

    def exercise_http_api(self, module, state_class, server_class, handler_class, state_name):
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / "state.json"
            replacement = str(cache_path) if isinstance(module.STATE_CACHE_PATH, str) else cache_path
            with mock.patch.object(module, "STATE_CACHE_PATH", replacement):
                setattr(module, state_name, state_class())
                server = server_class(("127.0.0.1", 0), handler_class)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                base_url = f"http://127.0.0.1:{server.server_port}"
                try:
                    request = urllib.request.Request(
                        f"{base_url}/api/state",
                        data=json.dumps({"team1": {"ban": "Ana"}}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(request, timeout=5) as response:
                        posted = json.load(response)
                    with urllib.request.urlopen(f"{base_url}/api/state", timeout=5) as response:
                        fetched = json.load(response)
                    with urllib.request.urlopen(f"{base_url}/api/fonts", timeout=5) as response:
                        fonts = json.load(response)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)

            self.assertEqual(posted["team1"]["ban"], "Ana")
            self.assertEqual(fetched["team1"]["ban"], "Ana")
            self.assertIn("valorantMapPool", fetched)
            self.assertIn("logoParticle", fetched)
            self.assertIn("fonts", fonts)

    def test_desktop_http_api_round_trip(self):
        self.exercise_http_api(
            GUI,
            GUI.SharedState,
            GUI.ReusableThreadingHTTPServer,
            GUI.BridgeHandler,
            "SHARED_STATE",
        )

    def test_obs_http_api_round_trip(self):
        self.exercise_http_api(
            OBS_DOCK,
            OBS_DOCK._BridgeState,
            OBS_DOCK._ReusableThreadingHTTPServer,
            OBS_DOCK._BridgeHandler,
            "_BRIDGE_STATE",
        )

    def test_frozen_gui_cache_uses_persistent_local_app_data(self):
        with mock.patch.object(GUI.sys, "frozen", True, create=True):
            with mock.patch.dict(os.environ, {"LOCALAPPDATA": r"C:\BroadcastAppData"}):
                cache_path = GUI._resolve_state_cache_path()
        self.assertEqual(
            cache_path,
            Path(r"C:\BroadcastAppData") / "OW2HeroBansGUI" / "controller_state_cache.json",
        )


class AssetAndBuildTests(unittest.TestCase):
    def test_valorant_map_assets_match_tracked_filename_case(self):
        payload = json.loads((REPO_ROOT / "assets" / "valorant" / "maps.json").read_text(encoding="utf-8"))
        actual_paths = {
            file.relative_to(REPO_ROOT).as_posix()
            for file in (REPO_ROOT / "assets" / "valorant" / "maps").iterdir()
            if file.is_file()
        }
        for entry in payload["maps"]:
            expected = entry["imageAsset"].removeprefix("./")
            self.assertIn(expected, actual_paths, entry["displayName"])

    def test_exe_build_includes_every_root_overlay(self):
        build_script = (REPO_ROOT / "build_exe.bat").read_text(encoding="utf-8")
        overlay_pages = [
            "team1.html",
            "team2.html",
            "scoreboard-team1-name.html",
            "scoreboard-team2-name.html",
            "scoreboard-team1-logo.html",
            "scoreboard-team2-logo.html",
            "scoreboard-team1-score.html",
            "scoreboard-team2-score.html",
            "valorant-map-picks-bans.html",
            "valorant-map-picks.html",
            "logo-particle-alpha.html",
        ]
        for page in overlay_pages:
            self.assertIn(f'--add-data "{page};."', build_script, page)


if __name__ == "__main__":
    unittest.main()
