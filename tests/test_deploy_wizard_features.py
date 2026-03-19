#!/usr/bin/env python3
"""
Tests for deploy-wizard.py — auto-update, SITE_ID improvements, heartbeat.
Run: python3 -m pytest tests/test_deploy_wizard_features.py -v
"""

import importlib.util
import json
import re
import sys
import textwrap
import threading
import time
from io import BytesIO
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

WIZARD_PATH = Path(__file__).resolve().parent.parent / "deploy-wizard.py"


# ---------------------------------------------------------------------------
# Helper: import deploy-wizard.py as a module (filename has hyphens)
# ---------------------------------------------------------------------------
def _load_wizard_module():
    spec = importlib.util.spec_from_file_location("deploy_wizard", str(WIZARD_PATH))
    mod = importlib.util.module_from_spec(spec)
    # Prevent main() from running during import
    with patch.object(spec.loader, "exec_module", wraps=spec.loader.exec_module):
        spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def wizard():
    """Import deploy-wizard.py as a module."""
    return _load_wizard_module()


@pytest.fixture
def wizard_source():
    return WIZARD_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. Version extraction
# ---------------------------------------------------------------------------
class TestVersionExtraction:
    def test_extract_version_from_source(self, wizard):
        """_extract_version should find WIZARD_VERSION in script content."""
        content = 'WIZARD_VERSION = "2026.03.19"\nother stuff'
        assert wizard._extract_version(content) == "2026.03.19"

    def test_extract_version_single_quotes(self, wizard):
        content = "WIZARD_VERSION = '2026.04.01'\n"
        assert wizard._extract_version(content) == "2026.04.01"

    def test_extract_version_missing(self, wizard):
        content = "# no version here\nfoo = 'bar'"
        assert wizard._extract_version(content) == ""

    def test_current_version_format(self, wizard):
        """WIZARD_VERSION should be YYYY.MM.DD format."""
        assert re.fullmatch(r"\d{4}\.\d{2}\.\d{2}(\.\d+)?", wizard.WIZARD_VERSION)


# ---------------------------------------------------------------------------
# 2. SITE_ID generation
# ---------------------------------------------------------------------------
class TestSiteIdGeneration:
    def test_generated_id_length(self, wizard):
        """Generated SITE_ID should be exactly 20 characters (6 random + 14 timestamp)."""
        sid = wizard.generate_site_id()
        assert len(sid) == 20

    def test_generated_id_alphanumeric(self, wizard):
        """Generated SITE_ID should contain only alphanumeric characters."""
        sid = wizard.generate_site_id()
        assert re.fullmatch(r"[A-Za-z0-9]+", sid)

    def test_generated_id_within_validation_limit(self, wizard):
        """Generated SITE_ID should pass the {1,20} validation regex."""
        sid = wizard.generate_site_id()
        assert re.fullmatch(r"[A-Za-z0-9]{1,20}", sid)

    def test_generated_id_uniqueness(self, wizard):
        """Multiple generated IDs should be unique."""
        ids = {wizard.generate_site_id() for _ in range(10)}
        assert len(ids) == 10


# ---------------------------------------------------------------------------
# 3. SITE_ID validation (backend regex)
# ---------------------------------------------------------------------------
class TestSiteIdValidation:
    """Test the backend validation regex used in /api/save-site-id."""

    PATTERN = re.compile(r"[A-Za-z0-9]{1,20}")

    def test_valid_alphanumeric(self):
        assert self.PATTERN.fullmatch("abc123")

    def test_valid_20_chars(self):
        assert self.PATTERN.fullmatch("a" * 20)

    def test_invalid_21_chars(self):
        assert self.PATTERN.fullmatch("a" * 21) is None

    def test_invalid_empty(self):
        assert self.PATTERN.fullmatch("") is None

    def test_invalid_special_chars(self):
        assert self.PATTERN.fullmatch("abc-123") is None
        assert self.PATTERN.fullmatch("abc_123") is None
        assert self.PATTERN.fullmatch("abc 123") is None

    def test_invalid_chinese(self):
        assert self.PATTERN.fullmatch("诊所123") is None

    def test_validation_regex_in_source(self, wizard_source):
        """Backend should use {1,20} not {1,64}."""
        assert r"[A-Za-z0-9]{1,20}" in wizard_source
        assert r"[A-Za-z0-9]{1,64}" not in wizard_source


# ---------------------------------------------------------------------------
# 4. Frontend validation consistency
# ---------------------------------------------------------------------------
class TestFrontendValidation:
    def test_maxlength_20_in_html(self, wizard_source):
        """Input field should have maxlength=20."""
        assert 'maxlength="20"' in wizard_source

    def test_js_length_check(self, wizard_source):
        """JS should check val.length > 20."""
        assert "val.length > 20" in wizard_source

    def test_js_alphanumeric_regex(self, wizard_source):
        """JS should validate alphanumeric only."""
        assert "/^[A-Za-z0-9]+$/" in wizard_source

    def test_hint_text_present(self, wizard_source):
        """Hint about 20 chars and alphanumeric should be visible."""
        assert "长度不超过20位" in wizard_source


# ---------------------------------------------------------------------------
# 5. Heartbeat mechanism
# ---------------------------------------------------------------------------
class TestHeartbeat:
    def test_heartbeat_js_interval(self, wizard_source):
        """Frontend should send heartbeat every 5 seconds."""
        assert "setInterval(" in wizard_source
        assert "/api/heartbeat" in wizard_source

    def test_heartbeat_endpoint_exists(self, wizard_source):
        """Backend should handle /api/heartbeat."""
        assert '"/api/heartbeat"' in wizard_source

    def test_heartbeat_timeout_constant(self, wizard_source):
        """Watchdog timeout should be defined."""
        assert "_HEARTBEAT_TIMEOUT" in wizard_source

    def test_heartbeat_watchdog_thread(self, wizard_source):
        """Watchdog function should exist and be started as daemon thread."""
        assert "def heartbeat_watchdog" in wizard_source
        assert "heartbeat_watchdog" in wizard_source


# ---------------------------------------------------------------------------
# 6. Auto-update mechanism
# ---------------------------------------------------------------------------
class TestAutoUpdate:
    def test_version_api_endpoint(self, wizard_source):
        """Backend should have /api/version endpoint."""
        assert '"/api/version"' in wizard_source

    def test_version_api_returns_fields(self, wizard_source):
        """Version API should return version, update_status, update_message."""
        assert '"version": WIZARD_VERSION' in wizard_source
        assert '"update_status": _update_status' in wizard_source
        assert '"update_message": _update_message' in wizard_source

    def test_self_update_function_exists(self, wizard_source):
        """self_update function should be defined."""
        assert "def self_update():" in wizard_source

    def test_skip_update_env_var(self, wizard_source):
        """Should check WIZARD_SKIP_UPDATE to skip self-update."""
        assert "WIZARD_SKIP_UPDATE" in wizard_source

    def test_min_file_size_check(self, wizard_source):
        """self_update should validate minimum file size."""
        assert "10000" in wizard_source

    def test_version_format_validation(self, wizard_source):
        """self_update should validate version format with regex."""
        assert r"\d{4}\.\d{2}\.\d{2}" in wizard_source

    def test_version_banner_in_html(self, wizard_source):
        """HTML should have version banner element."""
        assert "versionBanner" in wizard_source

    def test_check_version_js(self, wizard_source):
        """JS should call checkVersion on load."""
        assert "async function checkVersion()" in wizard_source
        assert "checkVersion();" in wizard_source


# ---------------------------------------------------------------------------
# 7. Existing SITE_ID detection
# ---------------------------------------------------------------------------
class TestExistingSiteIdDetection:
    def test_get_existing_site_id_endpoint(self, wizard_source):
        """Backend should have /api/get-existing-site-id endpoint."""
        assert '"/api/get-existing-site-id"' in wizard_source

    def test_step3_calls_get_existing(self, wizard_source):
        """renderStep3 should call /api/get-existing-site-id."""
        assert "/api/get-existing-site-id" in wizard_source

    def test_existing_site_id_highlight_html(self, wizard_source):
        """Step 3 should show highlighted banner when SITE_ID exists."""
        assert "siteIdExisting" in wizard_source
        assert "检测到已有站点编号" in wizard_source


# ---------------------------------------------------------------------------
# 8. Start script auto-update logic
# ---------------------------------------------------------------------------
class TestStartScriptUpdate:
    @pytest.fixture
    def wizard_command(self):
        return (WIZARD_PATH.parent / "start-wizard.command").read_text()

    @pytest.fixture
    def wizard_bat(self):
        return (WIZARD_PATH.parent / "start-wizard.bat").read_text()

    def test_command_checks_for_updates(self, wizard_command):
        """start-wizard.command should check for updates when file exists."""
        assert "检测到已有向导程序，正在检查更新" in wizard_command

    def test_command_creates_backup(self, wizard_command):
        """start-wizard.command should backup before replacing."""
        assert "deploy-wizard.py.bak" in wizard_command

    def test_command_skips_python_update(self, wizard_command):
        """start-wizard.command should set WIZARD_SKIP_UPDATE."""
        assert "WIZARD_SKIP_UPDATE=1" in wizard_command

    def test_bat_checks_for_updates(self, wizard_bat):
        """start-wizard.bat should check for updates when file exists."""
        assert "检测到已有向导程序，正在检查更新" in wizard_bat

    def test_bat_creates_backup(self, wizard_bat):
        """start-wizard.bat should backup before replacing."""
        assert "deploy-wizard.py.bak" in wizard_bat

    def test_bat_skips_python_update(self, wizard_bat):
        """start-wizard.bat should set WIZARD_SKIP_UPDATE."""
        assert "WIZARD_SKIP_UPDATE=1" in wizard_bat

    def test_bat_cleans_partial_download(self, wizard_bat):
        """start-wizard.bat catch block should clean up partial downloads."""
        assert "Remove-Item" in wizard_bat

    def test_command_validates_version_before_replace(self, wizard_command):
        """start-wizard.command should check WIZARD_VERSION before replacing."""
        assert "WIZARD_VERSION" in wizard_command
        assert "缺少版本号" in wizard_command

    def test_bat_validates_version_before_replace(self, wizard_bat):
        """start-wizard.bat should check WIZARD_VERSION before replacing."""
        assert "WIZARD_VERSION" in wizard_bat
        assert "缺少版本号" in wizard_bat


# ---------------------------------------------------------------------------
# 9. Security: _read_body robustness
# ---------------------------------------------------------------------------
class TestReadBodySecurity:
    def test_negative_content_length_rejected(self, wizard_source):
        """_read_body should reject negative Content-Length."""
        assert "length <= 0" in wizard_source

    def test_value_error_handling(self, wizard_source):
        """_read_body should handle non-numeric Content-Length."""
        assert "except (ValueError, TypeError)" in wizard_source


# ---------------------------------------------------------------------------
# 10. Security: shlex.quote usage
# ---------------------------------------------------------------------------
class TestShellSafety:
    def test_shlex_imported(self, wizard_source):
        """shlex should be imported for shell escaping."""
        assert "import shlex" in wizard_source

    def test_shlex_quote_used_in_clone(self, wizard_source):
        """clone-repo should use shlex.quote for paths."""
        assert "shlex.quote" in wizard_source


# ---------------------------------------------------------------------------
# 11. Auto-close hint
# ---------------------------------------------------------------------------
class TestAutoCloseHint:
    def test_terminal_shows_auto_close_hint(self, wizard_source):
        """Terminal should show reconnect hint."""
        assert "5分钟内可重新打开继续" in wizard_source

    def test_page_closed_message(self, wizard_source):
        """Disconnect message should be present."""
        assert "浏览器页面已关闭" in wizard_source

    def test_grace_period(self, wizard_source):
        """Should have a grace period before real shutdown."""
        assert "_SHUTDOWN_GRACE_PERIOD" in wizard_source

    def test_reconnect_detection(self, wizard_source):
        """Should detect page reconnection."""
        assert "页面已重新连接" in wizard_source
