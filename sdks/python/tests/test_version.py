import re
from pathlib import Path

import doow_track
import doow_track.management as management
import doow_track.tracker as tracker

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def _manifest_version() -> str:
    match = re.search(r'^version = "([^"]+)"', PYPROJECT.read_text(), re.MULTILINE)
    assert match, "pyproject.toml declares no version"
    return match.group(1)


def test_the_reported_version_matches_the_package_version():
    expected = _manifest_version()

    assert doow_track.__version__ == expected
    assert tracker.SDK_VERSION == expected
    assert management.SDK_VERSION == expected
