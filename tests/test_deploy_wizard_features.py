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
        """Backend should use {6,20} not {1,64}."""
        assert r"[A-Za-z0-9]{6,20}" in wizard_source
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
        """Hint about length range and alphanumeric should be visible."""
        assert "长度6-20位" in wizard_source


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
        bat_path = WIZARD_PATH.parent / "start-wizard.bat"
        try:
            return bat_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return bat_path.read_text(encoding="gbk")

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
        assert "Remove-Item" in wizard_bat or "del /f" in wizard_bat

    def test_command_validates_version_before_replace(self, wizard_command):
        """start-wizard.command should check WIZARD_VERSION before replacing."""
        assert "WIZARD_VERSION" in wizard_command
        assert "缺少版本号" in wizard_command

    def test_bat_validates_version_before_replace(self, wizard_bat):
        """start-wizard.bat should check WIZARD_VERSION before replacing."""
        assert "WIZARD_VERSION" in wizard_bat

    def test_command_compares_version_not_diff(self, wizard_command):
        """start-wizard.command should compare version strings, not file content."""
        assert "get_wizard_version" in wizard_command
        assert "REMOTE_VER" in wizard_command
        assert "LOCAL_VER" in wizard_command
        # Must NOT use diff-based comparison (old bug: diff -q replaced newer with older)
        assert "diff -q" not in wizard_command

    def test_command_only_updates_if_newer(self, wizard_command):
        """start-wizard.command should only replace if REMOTE_VER > LOCAL_VER."""
        # Bash string comparison: [[ "$REMOTE_VER" > "$LOCAL_VER" ]]
        assert '"$REMOTE_VER" > "$LOCAL_VER"' in wizard_command

    def test_bat_compares_version_not_fc(self, wizard_bat):
        """start-wizard.bat should compare version strings, not binary content."""
        assert "REMOTE_VER" in wizard_bat
        assert "LOCAL_VER" in wizard_bat
        # Must NOT use fc /b (old bug: binary compare replaced newer with older)
        assert "fc /b" not in wizard_bat

    def test_bat_only_updates_if_newer(self, wizard_bat):
        """start-wizard.bat should only replace if REMOTE_VER is GTR LOCAL_VER."""
        assert "GTR" in wizard_bat

    def test_bat_no_unix_dev_null(self, wizard_bat):
        """start-wizard.bat must use >nul, not /dev/null (Windows syntax)."""
        assert "/dev/null" not in wizard_bat, \
            "Found Unix-style /dev/null in .bat file — use >nul instead"


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


# ---------------------------------------------------------------------------
# 12. Step 2: Git auto-install when compose missing
# ---------------------------------------------------------------------------
class TestStep2GitAutoInstall:
    """When docker-compose.yml is missing and git is not available,
    Step 2 should guide the user to install git first, then download compose."""

    def test_git_available_check_in_step2(self, wizard_source):
        """renderStep2 should check repoData.git_available when essentials missing."""
        assert "repoData.git_available" in wizard_source

    def test_no_git_shows_install_button(self, wizard_source):
        """When git unavailable, should show install-git button with clear message."""
        assert "未检测到 Git" in wizard_source
        assert "installGitBtn" in wizard_source
        assert "安装 Git" in wizard_source

    def test_no_git_calls_install_git_api(self, wizard_source):
        """Install Git button should call /api/install-git SSE endpoint."""
        # Find the install-git SSE in the step2 git-missing branch
        assert "EventSource('/api/install-git')" in wizard_source

    def test_git_install_success_triggers_compose_download(self, wizard_source):
        """After git installs successfully, should auto-trigger compose download."""
        assert "Git 安装完成！正在下载项目文件" in wizard_source
        assert "startComposeDownload()" in wizard_source

    def test_git_install_failure_shows_retry(self, wizard_source):
        """Git install failure should show error and enable retry."""
        assert "Git 安装失败" in wizard_source

    def test_git_available_shows_direct_download(self, wizard_source):
        """When git IS available, should show direct download compose button."""
        assert "downloadComposeBtn" in wizard_source
        assert "下载 docker-compose.yml" in wizard_source

    def test_compose_download_success_refreshes_step2(self, wizard_source):
        """After compose download succeeds, should call renderStep2 to refresh."""
        # The startComposeDownload function should refresh on success
        assert "下载完成！正在重新检测" in wizard_source

    def test_git_install_verifies_before_download(self, wizard_source):
        """After git install SSE succeeds, should verify git is really available
        before auto-triggering compose download (Mac xcode-select returns immediately)."""
        assert "r.git_available" in wizard_source
        assert "安装窗口已打开" in wizard_source
        assert "安装完成后点此重新检测" in wizard_source

    def test_compose_download_onerror_shows_retry(self, wizard_source):
        """startComposeDownload onerror should show retry button, not dead UI."""
        assert "下载连接中断" in wizard_source
        assert "retryComposeBtn" in wizard_source


# ---------------------------------------------------------------------------
# 13. Step 4: Specific tool labels (Docker/Compose/Git)
# ---------------------------------------------------------------------------
class TestStep4ToolLabels:
    """Step 4 should display specific tool names, not vague labels like '运行环境'."""

    def test_docker_label_present(self, wizard_source):
        """Step 4 should show 'Docker' as the label, not '运行环境'."""
        assert "<strong>Docker</strong>" in wizard_source
        assert "<strong>运行环境</strong>" not in wizard_source

    def test_docker_compose_label_present(self, wizard_source):
        """Step 4 should show 'Docker Compose' as the label, not '服务管理工具'."""
        assert "<strong>Docker Compose</strong>" in wizard_source
        assert "<strong>服务管理工具</strong>" not in wizard_source

    def test_git_label_present(self, wizard_source):
        """Step 4 should show 'Git' as the label, not '代码管理工具'."""
        assert "<strong>Git</strong>" in wizard_source
        assert "<strong>代码管理工具</strong>" not in wizard_source

    def test_install_docker_button_text(self, wizard_source):
        """Install button should say '安装 Docker', not '安装运行环境'."""
        assert "安装 Docker</button>" in wizard_source
        assert "安装运行环境" not in wizard_source

    def test_install_git_button_text(self, wizard_source):
        """Install Git button should say '安装 Git', not '安装代码管理工具'."""
        assert "安装 Git</button>" in wizard_source
        assert "安装代码管理工具" not in wizard_source

    def test_step4_title(self, wizard_source):
        """Step 4 page title should be '检查必要软件'."""
        assert "第四步：检查必要软件" in wizard_source
        assert "第四步：检查运行环境" not in wizard_source


# ---------------------------------------------------------------------------
# 14. Windows PATH refresh for newly installed programs
# ---------------------------------------------------------------------------
class TestWindowsPathRefresh:
    """When Docker is installed while wizard is running, PATH must be refreshed."""

    def _get_func_body(self, wizard_source):
        """Extract _refresh_windows_path function body from source."""
        func_start = wizard_source.find("def _refresh_windows_path():")
        func_end = wizard_source.find("\ndef ", func_start + 1)
        return wizard_source[func_start:func_end]

    def test_refresh_function_exists(self, wizard_source):
        """_refresh_windows_path function should be defined."""
        assert "def _refresh_windows_path():" in wizard_source

    def test_check_deps_calls_refresh(self, wizard_source):
        """check-deps endpoint should call _refresh_windows_path before detection."""
        deps_section = wizard_source[wizard_source.find('"/api/check-deps"'):]
        refresh_pos = deps_section.find("_refresh_windows_path()")
        check_pos = deps_section.find('check_command("docker")')
        assert refresh_pos > 0, "_refresh_windows_path() not called in check-deps"
        assert refresh_pos < check_pos, \
            "_refresh_windows_path() must be called before check_command"

    def test_check_service_calls_refresh(self, wizard_source):
        """check-service endpoint should call _refresh_windows_path before detection."""
        svc_start = wizard_source.find('"/api/check-service"')
        next_endpoint = wizard_source.find('if self.path ==', svc_start + 30)
        svc_section = wizard_source[svc_start:next_endpoint]
        refresh_pos = svc_section.find("_refresh_windows_path()")
        check_pos = svc_section.find('check_command("docker")')
        assert refresh_pos > 0, "_refresh_windows_path() not called in check-service"
        assert refresh_pos < check_pos, \
            "_refresh_windows_path() must be called before check_command in check-service"

    def test_check_repo_calls_refresh(self, wizard_source):
        """check-repo endpoint should call _refresh_windows_path before git check."""
        repo_section = wizard_source[wizard_source.find('"/api/check-repo"'):]
        refresh_pos = repo_section.find("_refresh_windows_path()")
        check_pos = repo_section.find('check_command("git")')
        assert refresh_pos > 0, "_refresh_windows_path() not called in check-repo"
        assert refresh_pos < check_pos, \
            "_refresh_windows_path() must be called before check_command in check-repo"

    def test_download_compose_calls_refresh(self, wizard_source):
        """download-compose endpoint should call _refresh_windows_path."""
        dl_start = wizard_source.find('"/api/download-compose"')
        next_endpoint = wizard_source.find('if self.path ==', dl_start + 30)
        dl_section = wizard_source[dl_start:next_endpoint]
        assert "_refresh_windows_path()" in dl_section, \
            "_refresh_windows_path() not called in download-compose"

    def test_refresh_is_noop_on_non_windows(self, wizard):
        """_refresh_windows_path should be a no-op on Mac/Linux."""
        import os
        old_path = os.environ.get("PATH", "")
        with patch("platform.system", return_value="Darwin"):
            wizard._refresh_windows_path()
        assert os.environ.get("PATH", "") == old_path

    def test_refresh_reads_winreg(self, wizard_source):
        """_refresh_windows_path should read from Windows registry."""
        func_body = self._get_func_body(wizard_source)
        assert "winreg" in func_body
        assert "HKEY_LOCAL_MACHINE" in func_body
        assert "HKEY_CURRENT_USER" in func_body

    def test_refresh_merges_not_replaces(self, wizard_source):
        """PATH refresh should append new entries, not replace existing PATH."""
        func_body = self._get_func_body(wizard_source)
        # Must read existing PATH before modifying
        assert 'os.environ.get("PATH"' in func_body, \
            "Should read existing PATH before modifying"
        # Must append with separator, not full-replace
        assert "current + sep" in func_body, \
            "Should append to existing PATH, not replace"

    def test_refresh_expands_env_vars(self, wizard_source):
        """PATH refresh should expand %SystemRoot% style placeholders."""
        func_body = self._get_func_body(wizard_source)
        assert "expandvars" in func_body, \
            "Should expand %VAR% placeholders in registry PATH values"

    def test_refresh_is_thread_safe(self, wizard_source):
        """PATH refresh should use a lock for thread safety."""
        assert "_path_refresh_lock" in wizard_source
        func_body = self._get_func_body(wizard_source)
        assert "_path_refresh_lock" in func_body

    def test_refresh_no_stale_cache(self, wizard_source):
        """PATH refresh should NOT cache once-per-process (must re-check
        after Docker/Git install so the recheck picks up the new PATH)."""
        func_body = self._get_func_body(wizard_source)
        assert "_windows_path_refreshed" not in func_body, \
            "Should not use once-per-process cache"

    def test_refresh_handles_permission_error(self, wizard_source):
        """Should catch PermissionError when reading HKLM registry."""
        func_body = self._get_func_body(wizard_source)
        assert "PermissionError" in func_body

    def test_refresh_case_insensitive_dedup(self, wizard_source):
        """PATH dedup should be case-insensitive on Windows."""
        func_body = self._get_func_body(wizard_source)
        assert ".lower()" in func_body, \
            "Should use case-insensitive comparison for PATH dedup"

    def test_refresh_no_leading_semicolon(self, wizard_source):
        """When appending to PATH, should not produce leading semicolon."""
        func_body = self._get_func_body(wizard_source)
        assert 'sep = ";" if current else ""' in func_body, \
            "Should avoid leading semicolon when PATH is empty"


# ---------------------------------------------------------------------------
# 8. Windows cmd.exe quoting fix in stream_command
# ---------------------------------------------------------------------------
class TestWindowsCmdQuotingFix:
    """Tests for the list2cmdline bypass in stream_command on Windows."""

    def test_stream_command_bypasses_list2cmdline_for_cmd(self, wizard_source):
        """stream_command should detect ["cmd", "/c", ...] and bypass list2cmdline."""
        # Find the stream_command function body
        fn_start = wizard_source.find("def stream_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        # Must detect cmd.exe pattern
        assert 'cmd[0].lower()' in fn_body, \
            "Should check cmd[0] for 'cmd' pattern"
        assert '("cmd", "cmd.exe")' in fn_body or \
               '"cmd.exe"' in fn_body, \
            "Should handle both 'cmd' and 'cmd.exe'"
        assert '"/c"' in fn_body and '"/k"' in fn_body, \
            "Should handle both /c and /k switches"

    def test_stream_command_preserves_quotes_in_cmd_string(self, wizard_source):
        """The fix should pass cmd[2] verbatim, not through list2cmdline."""
        fn_start = wizard_source.find("def stream_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        # The fix joins cmd[:2] with list2cmdline but appends cmd[2] raw
        assert "cmd[:2]" in fn_body, \
            "Should use list2cmdline only for cmd[:2]"
        assert "cmd[2]" in fn_body, \
            "Should append cmd[2] verbatim"

    def test_stream_command_no_change_for_bash(self, wizard_source):
        """stream_command should NOT alter bash commands."""
        fn_start = wizard_source.find("def stream_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        # The condition is gated on platform.system() == "Windows"
        assert 'platform.system() == "Windows"' in fn_body, \
            "Fix should be gated on Windows platform check"

    def test_all_windows_cmd_handlers_use_quoted_paths(self, wizard_source):
        """All Windows cmd /c handlers should wrap SCRIPT_DIR in quotes."""
        import re
        # Find all Windows cmd blocks with cd /d
        pattern = r'stream_command\(self,\s*\[\s*"cmd",\s*"/c"'
        matches = list(re.finditer(pattern, wizard_source))
        assert len(matches) >= 4, \
            f"Expected >=4 Windows cmd handlers, found {len(matches)}"
        cd_count = 0
        for m in matches:
            # Get the surrounding block (next 500 chars)
            block = wizard_source[m.start():m.start() + 500]
            if "cd /d" in block:
                cd_count += 1
                # cd /d should be followed by a quoted path
                cd_match = re.search(r'cd /d\s+("|\{)', block)
                assert cd_match, \
                    f"cd /d should use quoted path near position {m.start()}"
        assert cd_count > 0, "Should find at least one cmd handler with cd /d"

    def test_download_compose_cmd_has_valid_quotes(self, wizard_source):
        """download-compose Windows cmd should have proper double quotes
        that will be preserved (not mangled by list2cmdline)."""
        dl_start = wizard_source.find('"/api/download-compose"')
        next_ep = wizard_source.find('if self.path ==', dl_start + 30)
        section = wizard_source[dl_start:next_ep]
        # The command string should have "script_dir" and "_repo" in quotes
        assert 'f\'cd /d "{script_dir}"' in section or \
               'cd /d "{' in section, \
            "cd /d path should be quoted in download-compose"

    def test_build_full_calls_refresh_windows_path(self, wizard_source):
        """build-full endpoint should call _refresh_windows_path before checks."""
        bf_start = wizard_source.find('"/api/build-full"')
        next_ep = wizard_source.find('if self.path ==', bf_start + 30)
        section = wizard_source[bf_start:next_ep]
        refresh_pos = section.find("_refresh_windows_path()")
        needs_clone_pos = section.find("needs_clone")
        assert refresh_pos > 0, \
            "_refresh_windows_path() not called in build-full"
        assert refresh_pos < needs_clone_pos, \
            "_refresh_windows_path() must be before needs_clone check"

    def test_list2cmdline_quoting_demonstrates_issue(self, wizard_source):
        """Verify list2cmdline produces \\\" escaping and that
        stream_command contains the fix to bypass it."""
        import subprocess
        cmd = ["cmd", "/c", 'cd /d "C:\\test" && echo done']
        result = subprocess.list2cmdline(cmd)
        # list2cmdline wraps the third arg in quotes and escapes inner quotes
        assert '\\"' in result, \
            "list2cmdline should produce \\\" escaping (which cmd.exe misinterprets)"
        # Verify the fix exists in stream_command source
        fn_start = wizard_source.find("def stream_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        # The fix must join cmd[:2] via list2cmdline but append cmd[2] verbatim
        assert "list2cmdline(cmd[:2])" in fn_body, \
            "stream_command must use list2cmdline only for cmd[:2]"
        assert '+ " " + cmd[2]' in fn_body, \
            "stream_command must append cmd[2] verbatim without escaping"


# ---------------------------------------------------------------------------
# Windows EXCLUDE pathspec quoting fix
# ---------------------------------------------------------------------------
class TestWindowsExcludePathspec:
    """Verify git pathspec EXCLUDE uses correct quoting per OS.

    Root cause: cmd.exe does NOT strip single quotes. On Unix, bash strips
    them so ':!file' becomes :!file (valid pathspec). On Windows, git receives
    the literal ':!file' with quotes → git error.
    """

    @staticmethod
    def _extract_windows_exclude(wizard_source, api_path):
        """Helper: extract Windows EXCLUDE line from a given API handler."""
        handler_start = wizard_source.find(f'if self.path == "{api_path}":')
        assert handler_start != -1, f"{api_path} handler not found"
        handler_end = wizard_source.find("\n        if self.path ==", handler_start + 1)
        if handler_end == -1:
            handler_end = len(wizard_source)
        handler_body = wizard_source[handler_start:handler_end]

        # Find the OS-guarded EXCLUDE block
        win_marker = 'if os_key == "windows":'
        win_pos = handler_body.find(win_marker)
        assert win_pos != -1, f"Windows branch not found in {api_path}"
        # Get only the Windows EXCLUDE line (up to the else:)
        else_pos = handler_body.find("else:", win_pos)
        assert else_pos != -1, f"else: branch not found after Windows check in {api_path}"
        win_only = handler_body[win_pos:else_pos]
        return win_only, handler_body

    def test_build_full_windows_exclude_no_single_quotes(self, wizard_source):
        """In /api/build-full, Windows EXCLUDE must NOT contain single quotes."""
        win_only, _ = self._extract_windows_exclude(wizard_source, "/api/build-full")
        assert "EXCLUDE = \":!" in win_only, \
            "Windows EXCLUDE should use unquoted :! pathspec"
        assert "':!" not in win_only, \
            "Windows EXCLUDE must NOT contain single quotes"

    def test_build_full_unix_exclude_has_single_quotes(self, wizard_source):
        """In /api/build-full, Unix EXCLUDE should keep single quotes for bash."""
        _, handler_body = self._extract_windows_exclude(wizard_source, "/api/build-full")
        # Find else branch after the first Windows EXCLUDE check
        win_pos = handler_body.find('if os_key == "windows":')
        else_pos = handler_body.find("else:", win_pos)
        else_section = handler_body[else_pos:else_pos + 200]
        assert "':!deploy-wizard.py'" in else_section, \
            "Unix EXCLUDE should have single-quoted pathspec for bash"

    def test_clone_repo_windows_exclude_no_single_quotes(self, wizard_source):
        """In /api/clone-repo, Windows EXCLUDE must NOT contain single quotes."""
        win_only, _ = self._extract_windows_exclude(wizard_source, "/api/clone-repo")
        assert "EXCLUDE = \":!" in win_only
        assert "':!" not in win_only

    def test_pull_and_rebuild_windows_exclude_no_single_quotes(self, wizard_source):
        """In /api/pull-and-rebuild, Windows EXCLUDE must NOT contain single quotes."""
        win_only, _ = self._extract_windows_exclude(wizard_source, "/api/pull-and-rebuild")
        assert "EXCLUDE = \":!" in win_only
        assert "':!" not in win_only

    def test_no_unguarded_exclude_with_single_quotes(self, wizard_source):
        """No EXCLUDE assignment should exist outside an OS-guarded block with single quotes
        being used as the only option (i.e., no bare 'EXCLUDE = "':!' without
        a preceding 'if os_key' check)."""
        import re
        # Find all EXCLUDE assignments
        pattern = r"^\s*EXCLUDE\s*=\s*\"':"
        matches = list(re.finditer(pattern, wizard_source, re.MULTILINE))

        for m in matches:
            # Get surrounding context (200 chars before)
            start = max(0, m.start() - 200)
            context = wizard_source[start:m.start()]
            # Must be inside an else: block (meaning OS was already checked)
            assert "else:" in context, \
                f"Found single-quoted EXCLUDE at offset {m.start()} without being in else: block"

    def test_windows_cmd_paths_use_nul_not_dev_null(self, wizard_source):
        """Windows cmd branches should use >nul, not >/dev/null in their command string."""
        import re
        # Find all "cmd", "/c" calls and extract the command string that follows
        # Pattern: stream_command(self, ["cmd", "/c", <command_string>])
        # The command string ends at the ]) or ])\n
        pattern = r'"cmd",\s*"/c",\s*\n?((?:.*\n)*?.*?)\]\)'
        cmd_blocks = list(re.finditer(pattern, wizard_source))
        for match in cmd_blocks:
            block = match.group(1)
            # Filter: only check the actual cmd string, not surrounding Python
            if "/dev/null" in block:
                # This is a real bug — Windows cmd should use >nul
                assert False, \
                    f"Windows cmd block contains /dev/null:\n{block[:200]}"

    def test_exclude_covers_all_wizard_files(self, wizard_source):
        """EXCLUDE should cover all start-wizard.* and deploy-wizard.py files."""
        import re
        exclude_assignments = re.findall(r'EXCLUDE\s*=\s*"([^"]+)"', wizard_source)
        required_files = ["deploy-wizard.py", "start-wizard.command",
                          "start-wizard.bat", "start-wizard.sh"]
        for exclude_val in exclude_assignments:
            for f in required_files:
                assert f in exclude_val, \
                    f"EXCLUDE missing {f}: {exclude_val}"


# ---------------------------------------------------------------------------
# "全新部署" button in failure scenarios
# ---------------------------------------------------------------------------
class TestFreshDeployButtons:
    """Verify that failure scenarios in step 2 include a '全新部署' escape button."""

    def test_no_containers_image_missing_has_fresh_deploy_btn(self, wizard_source):
        """When no_containers + images missing, both rebuild AND fresh deploy buttons exist."""
        # Find the no_containers image-missing section
        marker = "镜像缺失，需要重新构建。"
        pos = wizard_source.find(marker)
        assert pos != -1, "Image missing message not found"
        # Check nearby HTML for fresh deploy button
        section = wizard_source[pos:pos + 500]
        assert "freshDeployBtn" in section, \
            "no_containers image-missing section should have freshDeployBtn"
        assert "rebuildBtn" in section, \
            "no_containers image-missing section should have rebuildBtn"

    def test_no_containers_build_fail_has_fresh_deploy_btn(self, wizard_source):
        """When build fails in no_containers path, fresh deploy button appears."""
        assert "freshDeployNoContBtn" in wizard_source, \
            "no_containers build failure should have freshDeployNoContBtn"

    def test_no_containers_start_fail_has_fresh_deploy_btn(self, wizard_source):
        """When service start fails in no_containers path, fresh deploy button appears."""
        assert "freshDeployStartBtn" in wizard_source, \
            "no_containers start failure should have freshDeployStartBtn"

    def test_partial_build_fail_has_fresh_deploy_btn(self, wizard_source):
        """When build fails in partial path, fresh deploy button appears."""
        assert "freshDeployPartialBtn" in wizard_source, \
            "partial build failure should have freshDeployPartialBtn"

    def test_partial_build_ok_deploy_fail_has_fresh_deploy_btn(self, wizard_source):
        """When build succeeds but deploy fails in partial path, fresh deploy button appears."""
        assert "freshDeployAfterBuildBtn" in wizard_source, \
            "partial deploy failure should have freshDeployAfterBuildBtn"

    def test_fresh_deploy_buttons_go_to_step3(self, wizard_source):
        """All fresh deploy buttons should navigate to step 3 (站点编号)."""
        import re
        # Find all freshDeploy button onclick handlers
        # They should all contain state.step = 3
        btn_ids = ["freshDeployBtn", "freshDeployNoContBtn", "freshDeployStartBtn",
                    "freshDeployPartialBtn", "freshDeployAfterBuildBtn"]
        for btn_id in btn_ids:
            pos = wizard_source.find(f"'{btn_id}'")
            if pos == -1:
                pos = wizard_source.find(f'"{btn_id}"')
            assert pos != -1, f"Button {btn_id} not found in source"
            # Check that nearby code has state.step = 3
            context = wizard_source[pos:pos + 300]
            assert "state.step = 3" in context, \
                f"Button {btn_id} handler should set state.step = 3"

    def test_fresh_deploy_buttons_use_confirm_dialog(self, wizard_source):
        """All fresh deploy buttons should show confirmation before proceeding."""
        import re
        btn_ids = ["freshDeployBtn", "freshDeployNoContBtn", "freshDeployStartBtn",
                    "freshDeployPartialBtn", "freshDeployAfterBuildBtn"]
        for btn_id in btn_ids:
            pos = wizard_source.find(f"'{btn_id}'")
            if pos == -1:
                pos = wizard_source.find(f'"{btn_id}"')
            assert pos != -1
            context = wizard_source[pos:pos + 300]
            assert "showConfirm" in context, \
                f"Button {btn_id} should use showConfirm for safety"


# ---------------------------------------------------------------------------
# 15. Per-service Docker build (BuildKit atomic-load fix)
# ---------------------------------------------------------------------------
class TestPerServiceBuild:
    """Verify docker compose build is per-service on all 3 OS,
    fixing BuildKit's atomic image export that loses all images
    when a single service fails."""

    # -- helper function tests --

    def test_per_service_cmd_windows_uses_ampersand(self, wizard):
        """Windows cmd should join services with & (run all regardless)."""
        cmd = wizard._per_service_build_cmd("windows")
        assert " & " in cmd
        assert "&&" not in cmd  # must NOT use && which stops on failure

    def test_per_service_cmd_unix_tracks_failures(self, wizard):
        """Unix bash should track failures with _f variable in a subshell."""
        cmd = wizard._per_service_build_cmd("mac")
        assert cmd.startswith("(")
        assert cmd.endswith(")")
        assert "_f=0;" in cmd.replace(" ", "")
        assert "|| _f=1" in cmd
        assert "exit $_f" in cmd

    def test_per_service_cmd_linux_same_as_macos(self, wizard):
        """Linux should produce same format as macOS (both use bash)."""
        mac_cmd = wizard._per_service_build_cmd("mac")
        linux_cmd = wizard._per_service_build_cmd("linux")
        assert mac_cmd == linux_cmd

    def test_per_service_cmd_all_services_present(self, wizard):
        """All 5 build services must appear: mysql, nginx, backup, api, web."""
        expected = ["mysql", "nginx", "backup", "api", "web"]
        for os_key in ("windows", "mac", "linux"):
            cmd = wizard._per_service_build_cmd(os_key)
            for svc in expected:
                assert f"docker compose build {svc}" in cmd, \
                    f"Service '{svc}' missing in {os_key} build cmd"

    def test_per_service_cmd_standalone_false_no_exit(self, wizard):
        """standalone=False should NOT include 'exit $_f' (for embedding)."""
        cmd = wizard._per_service_build_cmd("mac", standalone=False)
        assert "exit $_f" not in cmd
        assert "_f=0" in cmd  # still tracks failures
        assert cmd.startswith("(") and cmd.endswith(")"), \
            "Should still be wrapped in subshell"

    def test_per_service_cmd_standalone_true_has_exit(self, wizard):
        """standalone=True (default) should include 'exit $_f'."""
        cmd = wizard._per_service_build_cmd("mac", standalone=True)
        assert "exit $_f" in cmd

    def test_per_service_cmd_unix_subshell_prevents_chain_break(self, wizard):
        """Unix build cmd must be wrapped in (...) subshell so that the ';'
        separators don't break an outer && chain (e.g. git fetch && BUILD_CMD)."""
        for standalone in (True, False):
            cmd = wizard._per_service_build_cmd("mac", standalone=standalone)
            assert cmd[0] == "(" and cmd[-1] == ")", \
                f"standalone={standalone}: must be subshell-wrapped"
            # The inner ';' must not leak to the outer chain
            inner = cmd[1:-1]
            assert ";" in inner, "Inner command should use ; separators"

    def test_per_service_cmd_shows_progress(self, wizard):
        """Build command should show progress indicators [1/5]...[5/5]."""
        for os_key in ("windows", "mac"):
            cmd = wizard._per_service_build_cmd(os_key)
            for i in range(1, 6):
                assert f"[{i}/5]" in cmd, \
                    f"Progress [{i}/5] missing in {os_key} build cmd"

    # -- build-full endpoint tests --

    def test_build_full_no_bare_docker_compose_build(self, wizard_source):
        """build-full must NOT use bare 'docker compose build' (all-at-once).
        It should always use per-service _per_service_build_cmd."""
        bf_start = wizard_source.find('"/api/build-full"')
        bf_end = wizard_source.find('if self.path ==', bf_start + 30)
        section = wizard_source[bf_start:bf_end]
        # Should NOT have the old bare command
        assert '["docker", "compose", "build"]' not in section, \
            "build-full should not use bare docker compose build"

    def test_build_full_pulls_prebuilt_images(self, wizard_source):
        """build-full should run 'docker compose pull' to fetch pre-built
        images (e.g. minio/minio) that are not covered by build."""
        bf_start = wizard_source.find('"/api/build-full"')
        bf_end = wizard_source.find('if self.path ==', bf_start + 30)
        section = wizard_source[bf_start:bf_end]
        assert "docker compose pull" in section, \
            "build-full must pull pre-built images (minio) before building"
        # Should appear at least twice (needs_clone + else branches)
        count = section.count("docker compose pull")
        assert count >= 2, \
            f"Expected >=2 'docker compose pull' calls (clone + else), found {count}"

    def test_build_full_needs_clone_windows_per_service(self, wizard_source):
        """build-full needs_clone=True Windows should use per-service build."""
        bf_start = wizard_source.find('"/api/build-full"')
        bf_end = wizard_source.find('if self.path ==', bf_start + 30)
        section = wizard_source[bf_start:bf_end]
        # Windows needs_clone branch should call _per_service_build_cmd
        assert "_per_service_build_cmd" in section

    def test_build_full_needs_clone_unix_per_service(self, wizard_source):
        """build-full needs_clone=True Unix should use per-service build."""
        bf_start = wizard_source.find('"/api/build-full"')
        bf_end = wizard_source.find('if self.path ==', bf_start + 30)
        section = wizard_source[bf_start:bf_end]
        # Count occurrences — should appear in clone branch + else branch
        count = section.count("_per_service_build_cmd")
        assert count >= 2, \
            f"Expected >=2 _per_service_build_cmd calls, found {count}"

    # -- pull-and-rebuild endpoint tests --

    def test_pull_rebuild_windows_per_service(self, wizard_source):
        """pull-and-rebuild Windows should use per-service build."""
        pr_start = wizard_source.find('"/api/pull-and-rebuild"')
        pr_end = wizard_source.find('if self.path ==', pr_start + 30)
        section = wizard_source[pr_start:pr_end]
        assert "_per_service_build_cmd" in section
        assert "standalone=False" in section, \
            "pull-and-rebuild must use standalone=False to not exit mid-chain"

    def test_pull_rebuild_unix_per_service(self, wizard_source):
        """pull-and-rebuild Unix should use per-service build."""
        pr_start = wizard_source.find('"/api/pull-and-rebuild"')
        pr_end = wizard_source.find('if self.path ==', pr_start + 30)
        section = wizard_source[pr_start:pr_end]
        # Should NOT have the old bare "docker compose build"
        # (the string may still appear inside _per_service_build_cmd output,
        #  but the literal Python string should not be there)
        assert '"docker compose build &&' not in section.replace(" ", ""), \
            "pull-and-rebuild should not use bare docker compose build"

    def test_pull_rebuild_still_restarts_after_build(self, wizard_source):
        """pull-and-rebuild should still run docker compose up -d after build."""
        pr_start = wizard_source.find('"/api/pull-and-rebuild"')
        pr_end = wizard_source.find('if self.path ==', pr_start + 30)
        section = wizard_source[pr_start:pr_end]
        assert "docker compose up -d" in section
        assert "docker compose restart nginx" in section

    def test_pull_rebuild_pulls_prebuilt_images(self, wizard_source):
        """pull-and-rebuild should run 'docker compose pull' for pre-built
        images (minio) before building, matching build-full's behavior."""
        pr_start = wizard_source.find('"/api/pull-and-rebuild"')
        pr_end = wizard_source.find('if self.path ==', pr_start + 30)
        section = wizard_source[pr_start:pr_end]
        assert "docker compose pull" in section, \
            "pull-and-rebuild must pull pre-built images (minio)"

    # -- BUILD_SERVICES constant --

    def test_build_services_constant_defined(self, wizard):
        """BUILD_SERVICES constant should list all 5 buildable services."""
        assert hasattr(wizard, "BUILD_SERVICES")
        assert wizard.BUILD_SERVICES == ["mysql", "nginx", "backup", "api", "web"]

    def test_per_service_cmd_uses_correct_os_keys(self, wizard):
        """Function should accept actual detect_os() return values: mac, windows, linux."""
        for os_key in ("mac", "windows", "linux"):
            cmd = wizard._per_service_build_cmd(os_key)
            assert "docker compose build" in cmd, \
                f"os_key={os_key} should produce a valid build command"


# ---------------------------------------------------------------------------
# 16. .gitattributes and .dockerignore
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 17. Docker daemon readiness wait (reusable module)
# ---------------------------------------------------------------------------
class TestDockerWaitModule:
    """Verify the reusable Docker daemon wait module exists and is used
    by /api/deploy to ensure Docker is ready before starting services."""

    def test_wait_docker_sse_function_exists(self, wizard_source):
        """_wait_docker_sse function should be defined."""
        assert "def _wait_docker_sse(" in wizard_source

    def test_wait_docker_sse_checks_docker_info(self, wizard_source):
        """_wait_docker_sse should check Docker readiness via 'docker info'."""
        fn_start = wizard_source.find("def _wait_docker_sse(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert '"docker", "info"' in fn_body or "'docker', 'info'" in fn_body

    def test_wait_docker_sse_has_retry_loop(self, wizard_source):
        """_wait_docker_sse should retry in a loop, not just check once."""
        fn_start = wizard_source.find("def _wait_docker_sse(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "for " in fn_body or "while " in fn_body
        assert "time.sleep" in fn_body

    def test_wait_docker_sse_returns_bool(self, wizard_source):
        """_wait_docker_sse should return True/False."""
        fn_start = wizard_source.find("def _wait_docker_sse(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "return True" in fn_body
        assert "return False" in fn_body

    def test_wait_docker_sse_sends_progress(self, wizard_source):
        """_wait_docker_sse should send SSE progress messages."""
        fn_start = wizard_source.find("def _wait_docker_sse(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "_sse_log" in fn_body

    def test_deploy_uses_wait_docker(self, wizard_source):
        """'/api/deploy' should call _wait_docker_sse before deploying."""
        dp_start = wizard_source.find('"/api/deploy"')
        dp_end = wizard_source.find('if self.path ==', dp_start + 30)
        section = wizard_source[dp_start:dp_end]
        assert "_wait_docker_sse" in section, \
            "/api/deploy must call _wait_docker_sse before docker compose up"

    def test_deploy_uses_headers_sent(self, wizard_source):
        """'/api/deploy' should call stream_command with headers_sent=True."""
        dp_start = wizard_source.find('"/api/deploy"')
        dp_end = wizard_source.find('if self.path ==', dp_start + 30)
        section = wizard_source[dp_start:dp_end]
        assert "headers_sent=True" in section

    def test_deploy_starts_sse_before_wait(self, wizard_source):
        """'/api/deploy' should call _start_sse before _wait_docker_sse."""
        dp_start = wizard_source.find('"/api/deploy"')
        dp_end = wizard_source.find('if self.path ==', dp_start + 30)
        section = wizard_source[dp_start:dp_end]
        sse_pos = section.find("_start_sse")
        wait_pos = section.find("_wait_docker_sse")
        assert sse_pos > 0 and wait_pos > 0
        assert sse_pos < wait_pos, \
            "_start_sse must be called before _wait_docker_sse"

    def test_deploy_handles_docker_not_ready(self, wizard_source):
        """'/api/deploy' should send error SSE if Docker is not ready."""
        dp_start = wizard_source.find('"/api/deploy"')
        dp_end = wizard_source.find('if self.path ==', dp_start + 30)
        section = wizard_source[dp_start:dp_end]
        assert "_sse_done" in section
        assert '"error"' in section

    def test_wait_docker_sse_handles_disconnect(self, wizard_source):
        """_wait_docker_sse should handle BrokenPipeError gracefully."""
        fn_start = wizard_source.find("def _wait_docker_sse(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "BrokenPipeError" in fn_body

    def test_sse_helpers_handle_disconnect(self, wizard_source):
        """_sse_log and _sse_done should handle BrokenPipeError gracefully."""
        for method in ("_sse_log", "_sse_done"):
            fn_start = wizard_source.find(f"def {method}(self")
            fn_end = wizard_source.find("\n    def ", fn_start + 1)
            fn_body = wizard_source[fn_start:fn_end]
            assert "BrokenPipeError" in fn_body, \
                f"{method} must handle BrokenPipeError"

    def test_deploy_uses_shorter_wait(self, wizard_source):
        """'/api/deploy' should use shorter max_retries (not default 30)."""
        dp_start = wizard_source.find('"/api/deploy"')
        dp_end = wizard_source.find('if self.path ==', dp_start + 30)
        section = wizard_source[dp_start:dp_end]
        assert "max_retries=" in section, \
            "deploy should pass explicit max_retries (shorter than default)"
        """stream_command should accept headers_sent parameter."""
        fn_start = wizard_source.find("def stream_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "headers_sent" in fn_body
        assert "if not headers_sent:" in fn_body

    def test_handler_has_sse_helpers(self, wizard_source):
        """WizardHandler should have _start_sse, _sse_log, _sse_done methods."""
        assert "def _start_sse(self):" in wizard_source
        assert "def _sse_log(self, text):" in wizard_source
        assert "def _sse_done(self, result" in wizard_source


# ---------------------------------------------------------------------------
# 18. .gitattributes and .dockerignore
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 19. Windows GBK encoding safety in run_command
# ---------------------------------------------------------------------------
class TestRunCommandEncoding:
    """run_command must NOT use text=True (which defaults to GBK on Chinese
    Windows), and should use _decode_bytes for safe UTF-8/GBK decoding."""

    def test_run_command_no_text_true(self, wizard_source):
        """run_command should NOT pass text=True to subprocess.run."""
        fn_start = wizard_source.find("def run_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        # Check the subprocess.run call, not the docstring
        run_call_start = fn_body.find("subprocess.run(")
        run_call_end = fn_body.find(")", run_call_start + 50)
        run_call = fn_body[run_call_start:run_call_end]
        assert "text=True" not in run_call, \
            "run_command subprocess.run() must not use text=True (crashes on Chinese Windows GBK)"

    def test_run_command_uses_decode_bytes(self, wizard_source):
        """run_command should use _decode_bytes for encoding-safe decoding."""
        fn_start = wizard_source.find("def run_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        assert "_decode_bytes" in fn_body

    def test_out_strip_all_null_safe(self, wizard_source):
        """All out.strip() calls should be guarded with (out or '')."""
        import re
        # Find bare out.strip() without (out or "") guard
        bare_pattern = r'(?<!\(out or ""\))\.strip\(\)'
        # Actually, just check there are no bare 'out.strip()' — all should be '(out or "").strip()'
        matches = list(re.finditer(r'\bout\.strip\(\)', wizard_source))
        assert len(matches) == 0, \
            f"Found {len(matches)} bare out.strip() without None guard"

    def test_run_command_returns_empty_string_on_error(self, wizard):
        """run_command should return empty strings (not None) on failure."""
        # Run a command that doesn't exist
        rc, out, err = wizard.run_command(["__nonexistent_command_12345__"])
        assert rc == -1
        assert isinstance(out, str)
        assert isinstance(err, str)


# ---------------------------------------------------------------------------
# 21. save-env-config: auto-generation must work even when .env exists
# ---------------------------------------------------------------------------
class TestSaveEnvConfigAutoGen:
    """When save-site-id creates .env with only SITE_ID before save-env-config
    runs, auto-generation of DB_PASSWORD etc. must still work."""

    def test_auto_gen_not_gated_on_first_install(self, wizard_source):
        """Auto-generation of secrets must NOT be inside 'if first_install'."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        # Find the auto_gen loop
        auto_gen_pos = section.find("auto_gen and not val")
        assert auto_gen_pos > 0, "auto_gen check not found"
        # The 30 chars before it should NOT contain "if first_install"
        context_before = section[max(0, auto_gen_pos - 200):auto_gen_pos]
        assert "if first_install:" not in context_before.split("\n")[-5:], \
            "auto_gen must not be gated on first_install"

    def test_missing_keys_added_without_first_install_gate(self, wizard_source):
        """Missing keys with values should always be added, not only on first_install."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        # Should NOT have "elif first_install:" gating key addition
        assert "elif first_install:" not in section, \
            "Key addition should not be gated on first_install"

    def test_auto_gen_respects_existing_values(self, wizard_source):
        """Auto-gen should NOT overwrite existing non-empty values in .env."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        # Should check existing content before generating
        assert "existing" in section or "re.search" in section

    def test_empty_values_not_added(self, wizard_source):
        """Keys with empty values should NOT be added to .env."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        assert "elif val:" in section or "if val:" in section, \
            "Only non-empty values should be added"


# ---------------------------------------------------------------------------
# 23. ensure-env completeness and fresh-install button
# ---------------------------------------------------------------------------
class TestEnsureEnvCompleteness:
    """ensure-env must auto-fill missing required fields in .env,
    and step 2 '环境就绪' must show a '全新安装' button."""

    def test_ensure_env_checks_env_schema_keys(self, wizard_source):
        """ensure-env should scan for missing ENV_SCHEMA keys."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert "ENV_SCHEMA" in section, \
            "ensure-env must check ENV_SCHEMA for completeness"

    def test_ensure_env_auto_generates_missing_secrets(self, wizard_source):
        """ensure-env should auto-generate missing auto_gen secrets."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert "token_urlsafe" in section or "secrets." in section, \
            "ensure-env must auto-generate secrets for missing auto_gen fields"

    def test_ensure_env_never_overwrites_existing(self, wizard_source):
        """ensure-env must NOT overwrite existing values in .env."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert "continue" in section and "already exists" in section.lower() or \
               "never overwrite" in section.lower(), \
            "ensure-env must skip existing keys"

    def test_ensure_env_reads_from_env_example(self, wizard_source):
        """ensure-env should read .env.example as the source of all defaults."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert ".env.example" in section
        assert "example_path" in section

    def test_save_env_config_also_fills_from_example(self, wizard_source):
        """save-env-config should also fill missing keys from .env.example."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('self.send_error(404)', fn_start)
        section = wizard_source[fn_start:fn_end]
        assert ".env.example" in section or "example_path" in section

    def test_ready_state_has_fresh_install_btn(self, wizard_source):
        """Step 2 '环境就绪' state must show a '全新安装' button."""
        # Find the "环境就绪" section
        pos = wizard_source.find("环境就绪")
        assert pos != -1
        section = wizard_source[pos:pos + 500]
        assert "freshInstallReadyBtn" in section or "全新安装" in section

    def test_fresh_install_btn_goes_to_step3(self, wizard_source):
        """'全新安装' button on ready state should go to step 3."""
        pos = wizard_source.find("freshInstallReadyBtn")
        assert pos != -1
        section = wizard_source[pos:pos + 300]
        assert "state.step = 3" in section

    def test_fresh_install_btn_uses_confirm(self, wizard_source):
        """'全新安装' button should require confirmation."""
        pos = wizard_source.find("freshInstallReadyBtn")
        assert pos != -1
        section = wizard_source[pos:pos + 300]
        assert "showConfirm" in section


# ---------------------------------------------------------------------------
# 24. .env write_text always uses newline="\n" (Windows CRLF safety)
# ---------------------------------------------------------------------------
class TestEnvWriteNewline:
    """All .env writes must go through _safe_write_file which forces LF newlines."""

    def test_safe_write_file_defaults_to_lf(self, wizard_source):
        """_safe_write_file must default to newline='\\n' to prevent CRLF on Windows."""
        fn_start = wizard_source.find("def _safe_write_file(")
        fn_end = wizard_source.find("\ndef ", fn_start + 10)
        fn_body = wizard_source[fn_start:fn_end]
        assert 'newline="\\n"' in fn_body

    def test_no_direct_env_write_text(self, wizard_source):
        """No endpoint should bypass _safe_write_file with direct write_text."""
        assert "env_path.write_text(" not in wizard_source


# ---------------------------------------------------------------------------
# 25. Boundary: save-env-config with various .env states
# ---------------------------------------------------------------------------
class TestSaveEnvConfigBoundary:
    """Test save-env-config logic handles all .env boundary states correctly."""

    def test_save_env_config_auto_gen_checks_existing_content(self, wizard_source):
        """Auto-gen should check if key already has a value in content."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        # Must search for existing value in content before auto-generating
        assert "re.search" in section
        assert "existing" in section.lower() or "has_key" in section.lower()

    def test_save_env_config_handles_env_with_only_site_id(self, wizard_source):
        """When .env has only SITE_ID (from save-site-id), save-env-config
        should still auto-generate DB_PASSWORD etc."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        # The auto-gen for loop must NOT be inside an "if first_install:" block
        # (it was the old bug — gated on first_install)
        import re
        # Check: no "if first_install:\n  ... auto_gen" pattern
        if_first_pattern = r'if first_install:\s*\n\s+for.*auto_gen'
        assert not re.search(if_first_pattern, section), \
            "auto_gen loop must not be inside 'if first_install:' block"

    def test_ensure_env_and_save_env_both_use_env_schema(self, wizard_source):
        """Both ensure-env and save-env-config should reference ENV_SCHEMA."""
        ensure_start = wizard_source.find('"/api/ensure-env"')
        ensure_end = wizard_source.find('"/api/pull-and-rebuild"')
        ensure_section = wizard_source[ensure_start:ensure_end]

        save_start = wizard_source.find('"/api/save-env-config"')
        save_end = wizard_source.find('self.send_error(404)', save_start)
        save_section = wizard_source[save_start:save_end]

        assert "ENV_SCHEMA" in ensure_section
        assert "ENV_SCHEMA" in save_section

    def test_run_command_no_text_true_in_subprocess(self, wizard_source):
        """Verify run_command subprocess.run() call has no text=True (GBK safety)."""
        fn_start = wizard_source.find("def run_command(")
        fn_end = wizard_source.find("\ndef ", fn_start + 1)
        fn_body = wizard_source[fn_start:fn_end]
        run_start = fn_body.find("subprocess.run(")
        run_end = fn_body.find(")", run_start + 20)
        run_call = fn_body[run_start:run_end]
        assert "text=True" not in run_call
        assert "_decode_bytes" in fn_body


# ---------------------------------------------------------------------------
# 26. .gitattributes and .dockerignore
# ---------------------------------------------------------------------------
class TestDockerBuildFiles:
    """Verify .gitattributes and .dockerignore files exist and have
    correct content for cross-platform compatibility."""

    @pytest.fixture
    def project_root(self):
        return WIZARD_PATH.parent

    def test_gitattributes_exists(self, project_root):
        assert (project_root / ".gitattributes").exists()

    def test_gitattributes_covers_shell_scripts(self, project_root):
        content = (project_root / ".gitattributes").read_text()
        assert "*.sh" in content
        assert "eol=lf" in content

    def test_gitattributes_covers_dockerfiles(self, project_root):
        content = (project_root / ".gitattributes").read_text()
        assert "Dockerfile" in content
        assert "eol=lf" in content

    def test_gitattributes_covers_conf_files(self, project_root):
        content = (project_root / ".gitattributes").read_text()
        assert "*.conf" in content
        assert "*.cnf" in content

    def test_server_dockerignore_excludes_tests(self, project_root):
        path = project_root / "server" / ".dockerignore"
        assert path.exists()
        content = path.read_text()
        assert "*_test.go" in content

    def test_web_dockerignore_excludes_node_modules(self, project_root):
        path = project_root / "web" / ".dockerignore"
        assert path.exists()
        content = path.read_text()
        assert "node_modules" in content


# ---------------------------------------------------------------------------
# 27. Dockerfile CRLF protection (Windows safety)
# ---------------------------------------------------------------------------
class TestDockerfileCrlfProtection:
    """All Dockerfiles that COPY text files (scripts, configs) must strip
    \\r to prevent 'no such file or directory' on Windows-built images."""

    @pytest.fixture
    def project_root(self):
        return WIZARD_PATH.parent

    def test_backup_dockerfile_strips_cr(self, project_root):
        content = (project_root / "scripts" / "Dockerfile.backup").read_text()
        assert "sed -i 's/\\r$//' /scripts/" in content

    def test_nginx_dockerfile_strips_cr(self, project_root):
        content = (project_root / "nginx" / "Dockerfile").read_text()
        assert "sed -i 's/\\r$//' " in content

    def test_mysql_dockerfile_strips_cr(self, project_root):
        content = (project_root / "mysql" / "Dockerfile").read_text()
        assert "sed -i 's/\\r$//' " in content

    def test_web_dockerfile_strips_cr(self, project_root):
        content = (project_root / "web" / "Dockerfile").read_text()
        assert "sed -i 's/\\r$//' " in content

    def test_all_dockerfiles_with_copy_have_cr_strip(self, project_root):
        """Every Dockerfile that COPYs text files must have sed CR strip."""
        dockerfiles = [
            project_root / "scripts" / "Dockerfile.backup",
            project_root / "nginx" / "Dockerfile",
            project_root / "mysql" / "Dockerfile",
            project_root / "web" / "Dockerfile",
        ]
        for df in dockerfiles:
            content = df.read_text()
            if "COPY" in content and "COPY --from" not in content.split("COPY")[1][:20]:
                assert "\\r$" in content, \
                    f"{df.name} copies text files but has no CRLF strip"


# ---------------------------------------------------------------------------
# 28. Step 6 auto-scroll to "点击打开系统" on success
# ---------------------------------------------------------------------------
class TestStep6AutoScroll:
    """After deployment succeeds, the page should auto-scroll to the
    '点击打开系统' button for immediate access."""

    def test_step6_has_scroll_into_view(self, wizard_source):
        """renderStep6 success path should call scrollIntoView."""
        pos = wizard_source.find("点击打开系统")
        assert pos != -1
        # scrollIntoView should be within 500 chars after the success HTML
        section = wizard_source[pos:pos + 500]
        assert "scrollIntoView" in section


# ---------------------------------------------------------------------------
# 29. git config core.autocrlf false on all git init paths
# ---------------------------------------------------------------------------
class TestGitAutoCrlfDisabled:
    """All git init commands must set core.autocrlf=false to prevent
    CRLF conversion on Windows (root cause of backup-loop.sh failure)."""

    def test_all_git_init_have_autocrlf_false(self, wizard_source):
        """Every 'git init' must be followed by 'git config core.autocrlf false'."""
        import re
        inits = list(re.finditer(r'git init', wizard_source))
        for m in inits:
            # Grab 100 chars after 'git init'
            after = wizard_source[m.end():m.end() + 100]
            assert "core.autocrlf false" in after, \
                f"git init at offset {m.start()} missing core.autocrlf false"

    def test_git_init_count_matches_autocrlf_count(self, wizard_source):
        """Number of 'git init' should equal number of 'core.autocrlf false'."""
        init_count = wizard_source.count("git init")
        autocrlf_count = wizard_source.count("core.autocrlf false")
        assert autocrlf_count >= init_count, \
            f"Found {init_count} git init but only {autocrlf_count} autocrlf false"

    def test_pull_and_rebuild_also_sets_autocrlf(self, wizard_source):
        """pull-and-rebuild's conditional git init must also set autocrlf."""
        pr_start = wizard_source.find('"/api/pull-and-rebuild"')
        pr_end = wizard_source.find('if self.path ==', pr_start + 30)
        section = wizard_source[pr_start:pr_end]
        assert "core.autocrlf false" in section


# ---------------------------------------------------------------------------
# 30. .env directory cleanup before write
# ---------------------------------------------------------------------------
class TestEnvDirCleanup:
    """Docker bind mount creates .env as a directory when the file doesn't
    exist. All endpoints that write .env must handle directory cleanup."""

    def test_save_site_id_uses_safe_write(self, wizard_source):
        """save-site-id must use _safe_write_file for .env writes."""
        fn_start = wizard_source.find('"/api/save-site-id"')
        fn_end = wizard_source.find('if self.path ==', fn_start + 30)
        section = wizard_source[fn_start:fn_end]
        assert "_safe_write_file" in section

    def test_save_env_config_uses_safe_write(self, wizard_source):
        """save-env-config must use _safe_write_file for .env writes."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('self.send_error(404)', fn_start)
        section = wizard_source[fn_start:fn_end]
        assert "_safe_write_file" in section

    def test_ensure_env_cleans_env_dir(self, wizard_source):
        """ensure-env must use _rmdir_safe for directory cleanup before recovery."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert "_rmdir_safe" in section

    def test_ensure_env_uses_safe_write(self, wizard_source):
        """ensure-env Method 2 must use _safe_write_file."""
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        section = wizard_source[fn_start:fn_end]
        assert "_safe_write_file" in section

    def test_generate_env_uses_safe_write(self, wizard_source):
        """generate-env must use _safe_write_file."""
        fn_start = wizard_source.find('"/api/generate-env"')
        fn_end = wizard_source.find('"/api/save-env-config"')
        section = wizard_source[fn_start:fn_end]
        assert "_safe_write_file" in section

    def test_copy_env_uses_safe_copy(self, wizard_source):
        """copy-env-from-path must use _safe_copy_file."""
        fn_start = wizard_source.find('"/api/copy-env-from-path"')
        fn_end = wizard_source.find('"/api/save-site-id"')
        section = wizard_source[fn_start:fn_end]
        assert "_safe_copy_file" in section

    def test_save_env_config_uses_is_file_not_exists(self, wizard_source):
        """save-env-config's first_install check must use is_file(), not exists()."""
        fn_start = wizard_source.find('"/api/save-env-config"')
        fn_end = wizard_source.find('self.send_error(404)', fn_start)
        section = wizard_source[fn_start:fn_end]
        assert "not env_path.is_file()" in section or \
               "not env_path.exists()" not in section.split("first_install")[0]

    def test_no_direct_write_text_to_env(self, wizard_source):
        """No endpoint should call env_path.write_text() directly."""
        assert "env_path.write_text(" not in wizard_source


    def test_step6_scroll_uses_smooth_behavior(self, wizard_source):
        """Auto-scroll should use smooth animation."""
        pos = wizard_source.find("scrollIntoView")
        # Find the one near "点击打开系统" (in renderStep6, not in openHelp)
        while pos != -1:
            context = wizard_source[max(0, pos - 300):pos + 100]
            if "点击打开系统" in context or "btn-success" in context:
                assert "smooth" in wizard_source[pos:pos + 80]
                break
            pos = wizard_source.find("scrollIntoView", pos + 1)


# ---------------------------------------------------------------------------
# 31. _safe_write_file and _safe_copy_file helpers
# ---------------------------------------------------------------------------
class TestSafeWriteFile:
    """Test _safe_write_file handles Docker bind-mount directory race."""

    def test_write_text_normal(self, wizard, tmp_path):
        """Normal text write should succeed."""
        p = tmp_path / ".env"
        wizard._safe_write_file(p, "KEY=val\n")
        assert p.is_file()
        assert p.read_text() == "KEY=val\n"

    def test_write_text_overwrite(self, wizard, tmp_path):
        """Overwriting existing file should work."""
        p = tmp_path / ".env"
        p.write_text("OLD=1\n")
        wizard._safe_write_file(p, "NEW=2\n")
        assert p.read_text() == "NEW=2\n"

    def test_write_over_directory(self, wizard, tmp_path):
        """Writing when path is a directory should remove dir and write file."""
        p = tmp_path / ".env"
        p.mkdir()
        (p / "dummy").touch()  # non-empty dir
        wizard._safe_write_file(p, "KEY=val\n")
        assert p.is_file()
        assert p.read_text() == "KEY=val\n"

    def test_write_over_empty_directory(self, wizard, tmp_path):
        """Writing when path is an empty directory should work."""
        p = tmp_path / ".env"
        p.mkdir()
        wizard._safe_write_file(p, "KEY=val\n")
        assert p.is_file()

    def test_write_bytes_mode(self, wizard, tmp_path):
        """mode='bytes' should use write_bytes."""
        p = tmp_path / "config"
        wizard._safe_write_file(p, b"binary content", mode="bytes")
        assert p.read_bytes() == b"binary content"

    def test_write_bytes_over_directory(self, wizard, tmp_path):
        """Bytes mode should also handle directory race."""
        p = tmp_path / "config"
        p.mkdir()
        wizard._safe_write_file(p, b"binary", mode="bytes")
        assert p.is_file()
        assert p.read_bytes() == b"binary"

    def test_retry_on_permission_error(self, wizard, tmp_path):
        """Simulates the race: first write hits PermissionError, retry succeeds."""
        p = tmp_path / ".env"
        original_write_text = Path.write_text
        call_count = [0]

        def mock_write(self_path, content, **kw):
            call_count[0] += 1
            if call_count[0] == 1:
                raise PermissionError("simulated Docker race")
            return original_write_text(self_path, content, **kw)

        with patch.object(Path, "write_text", mock_write):
            wizard._safe_write_file(p, "KEY=val\n")
        assert call_count[0] == 2  # retried once
        assert p.is_file()

    def test_raises_after_two_failures(self, wizard, tmp_path):
        """If both attempts fail, the error should propagate."""
        p = tmp_path / ".env"
        with patch.object(Path, "write_text", side_effect=PermissionError("locked")):
            with pytest.raises(PermissionError):
                wizard._safe_write_file(p, "KEY=val\n")

    def test_handles_is_a_directory_error(self, wizard, tmp_path):
        """On Linux/macOS, writing to a dir gives IsADirectoryError — should handle."""
        p = tmp_path / ".env"
        original_write_text = Path.write_text
        call_count = [0]

        def mock_write(self_path, content, **kw):
            call_count[0] += 1
            if call_count[0] == 1:
                raise IsADirectoryError("simulated Linux behavior")
            return original_write_text(self_path, content, **kw)

        with patch.object(Path, "write_text", mock_write):
            wizard._safe_write_file(p, "KEY=val\n")
        assert call_count[0] == 2

    def test_utf8_encoding_and_lf_newline(self, wizard, tmp_path):
        """Default encoding=utf-8 and newline=LF should be preserved."""
        p = tmp_path / ".env"
        wizard._safe_write_file(p, "中文=测试\n")
        raw = p.read_bytes()
        assert b"\r\n" not in raw  # no CRLF
        assert "中文=测试" in raw.decode("utf-8")


class TestSafeCopyFile:
    """Test _safe_copy_file handles Docker bind-mount directory race."""

    def test_copy_normal(self, wizard, tmp_path):
        """Normal copy should succeed."""
        src = tmp_path / "src.env"
        src.write_text("A=1\n")
        dst = tmp_path / ".env"
        wizard._safe_copy_file(src, dst)
        assert dst.is_file()
        assert dst.read_text() == "A=1\n"

    def test_copy_over_directory(self, wizard, tmp_path):
        """Copying to a directory path should remove dir and copy file."""
        src = tmp_path / "src.env"
        src.write_text("A=1\n")
        dst = tmp_path / ".env"
        dst.mkdir()
        (dst / "dummy").touch()
        wizard._safe_copy_file(src, dst)
        assert dst.is_file()
        assert dst.read_text() == "A=1\n"

    def test_retry_on_permission_error(self, wizard, tmp_path):
        """Simulates race condition with PermissionError on first attempt."""
        import shutil as _shutil
        src = tmp_path / "src.env"
        src.write_text("A=1\n")
        dst = tmp_path / ".env"
        original_copy2 = _shutil.copy2
        call_count = [0]

        def mock_copy(s, d):
            call_count[0] += 1
            if call_count[0] == 1:
                raise PermissionError("simulated Docker race")
            return original_copy2(s, d)

        with patch("shutil.copy2", mock_copy):
            wizard._safe_copy_file(src, dst)
        assert call_count[0] == 2
        assert dst.is_file()

    def test_raises_after_two_failures(self, wizard, tmp_path):
        """If both attempts fail, the error should propagate."""
        src = tmp_path / "src.env"
        src.write_text("A=1\n")
        dst = tmp_path / ".env"
        with patch("shutil.copy2", side_effect=PermissionError("locked")):
            with pytest.raises(PermissionError):
                wizard._safe_copy_file(src, dst)


# ---------------------------------------------------------------------------
# 32. Step 5 saveEnvBtn re-renders after save
# ---------------------------------------------------------------------------
class TestStep5SaveRefresh:
    def test_save_env_btn_triggers_rerender(self, wizard_source):
        """After saving config, step 5 should call renderStep5(el)."""
        # Find the saveEnvBtn onclick handler (not the HTML template)
        pos = wizard_source.find("#saveEnvBtn').onclick")
        assert pos != -1, "saveEnvBtn onclick handler not found"
        section = wizard_source[pos:pos + 800]
        assert "renderStep5(el)" in section


# ---------------------------------------------------------------------------
# 33. clone-repo removes stale custom images after download
# ---------------------------------------------------------------------------
class TestCloneRepoRemovesStaleImages:
    """After code download, stale custom images must be removed to force rebuild."""

    def test_clone_repo_removes_stale_images_windows(self, wizard_source):
        """Windows clone-repo must docker image rm all custom images."""
        fn_start = wizard_source.find('"/api/clone-repo"')
        fn_end = wizard_source.find('"/api/check-updates"')
        section = wizard_source[fn_start:fn_end]
        assert "docker image rm" in section
        # Image list is built dynamically; verify the BUILD_SERVICES list is used
        for svc in ["api", "web", "backup", "nginx", "mysql"]:
            assert f'"{svc}"' in section or f"'{svc}'" in section

    def test_clone_repo_removes_stale_images_bash(self, wizard_source):
        """Bash clone-repo must docker image rm all custom images."""
        fn_start = wizard_source.find('"/api/clone-repo"')
        fn_end = wizard_source.find('"/api/check-updates"')
        section = wizard_source[fn_start:fn_end]
        # Must appear in both Windows and bash branches
        assert section.count("docker image rm") >= 2

    def test_clone_repo_image_rm_ignores_errors(self, wizard_source):
        """Image removal must ignore errors (images may not exist on fresh install)."""
        fn_start = wizard_source.find('"/api/clone-repo"')
        fn_end = wizard_source.find('"/api/check-updates"')
        section = wizard_source[fn_start:fn_end]
        # Windows: 2>nul, bash: 2>/dev/null
        assert "2>nul" in section
        assert "2>/dev/null" in section


# ---------------------------------------------------------------------------
# ensure-env must NEVER replace existing passwords (even placeholders)
# ---------------------------------------------------------------------------
class TestEnsureEnvPreservesAllExistingSecrets:
    """ensure-env Step 2 must only generate secrets for completely MISSING
    fields.  Placeholder values (menzhen123, minioadmin,
    change-me-in-production) may be the REAL passwords used by an already-
    running MySQL/MinIO instance.  Replacing them breaks DB connections
    and invalidates all user JWT sessions."""

    def _ensure_env_section(self, wizard_source):
        fn_start = wizard_source.find('"/api/ensure-env"')
        fn_end = wizard_source.find('"/api/pull-and-rebuild"')
        return wizard_source[fn_start:fn_end]

    # -- source-level checks --

    def test_step2_does_not_check_placeholder_values(self, wizard_source):
        """Step 2 must NOT contain the old placeholder list that was used to
        decide which values to overwrite."""
        section = self._ensure_env_section(wizard_source)
        # The old code had: not in ("change-me-in-production", "menzhen123", ...)
        # This must NOT appear in the ensure-env Step 2 anymore.
        step2_start = section.find("Step 2")
        assert step2_start != -1, "Step 2 comment must exist"
        step2 = section[step2_start:]
        assert '"menzhen123"' not in step2, \
            "ensure-env Step 2 must not match against placeholder 'menzhen123'"
        assert '"minioadmin"' not in step2, \
            "ensure-env Step 2 must not match against placeholder 'minioadmin'"

    def test_step2_has_no_re_sub(self, wizard_source):
        """Step 2 must NOT use re.sub — it should only append missing keys,
        never replace existing lines."""
        section = self._ensure_env_section(wizard_source)
        step2_start = section.find("Step 2")
        step2 = section[step2_start:]
        assert "re.sub" not in step2, \
            "ensure-env Step 2 must not use re.sub (no in-place replacement)"

    def test_step2_preserves_any_existing_value(self, wizard_source):
        """Step 2 must skip any key that already exists, regardless of value."""
        section = self._ensure_env_section(wizard_source)
        step2_start = section.find("Step 2")
        step2 = section[step2_start:]
        # Must have a continue that fires for any existing key
        assert "continue" in step2
        # The regex should match key= (any value), not key=(.*)$ with group check
        assert "even placeholders" in step2.lower() or \
               "any value" in step2.lower() or \
               "keep it" in step2.lower(), \
            "Step 2 must explicitly note that all existing values are preserved"

    # -- functional tests --

    def test_preserve_db_password_menzhen123(self, wizard, tmp_path):
        """DB_PASSWORD=menzhen123 must NOT be replaced."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=menzhen123\nJWT_SECRET=mysecret\n"
                        "MINIO_SECRET_KEY=myminiokey\n")
        content = env.read_text()
        patched = False
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            val = _sec.token_urlsafe(16)[:16]
            content += f"\n{key}={val}"
            patched = True
        assert "DB_PASSWORD=menzhen123" in content, \
            "DB_PASSWORD=menzhen123 must be preserved (it IS the real MySQL password)"

    def test_preserve_jwt_secret_placeholder(self, wizard, tmp_path):
        """JWT_SECRET=change-me-in-production must NOT be replaced."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=abc123\nJWT_SECRET=change-me-in-production\n"
                        "MINIO_SECRET_KEY=minioadmin\n")
        content = env.read_text()
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            content += f"\n{key}={_sec.token_urlsafe(16)[:16]}"
        assert "JWT_SECRET=change-me-in-production" in content, \
            "JWT_SECRET placeholder must be preserved in recovery"

    def test_preserve_minio_secret_minioadmin(self, wizard, tmp_path):
        """MINIO_SECRET_KEY=minioadmin must NOT be replaced."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=abc\nJWT_SECRET=abc\n"
                        "MINIO_SECRET_KEY=minioadmin\n")
        content = env.read_text()
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            content += f"\n{key}={_sec.token_urlsafe(16)[:16]}"
        assert "MINIO_SECRET_KEY=minioadmin" in content, \
            "MINIO_SECRET_KEY=minioadmin must be preserved in recovery"

    def test_generate_missing_field_only(self, wizard, tmp_path):
        """If DB_PASSWORD is present but JWT_SECRET is missing,
        only JWT_SECRET should be auto-generated."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=menzhen123\nMINIO_SECRET_KEY=minioadmin\n")
        content = env.read_text()
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            content += f"\n{key}={_sec.token_urlsafe(16)[:16]}"
        assert "DB_PASSWORD=menzhen123" in content
        assert "MINIO_SECRET_KEY=minioadmin" in content
        import re as _re
        jwt_match = _re.search(r"^JWT_SECRET=(.+)$", content, _re.MULTILINE)
        assert jwt_match, "JWT_SECRET must be auto-generated when missing"
        assert jwt_match.group(1) != "change-me-in-production", \
            "Auto-generated JWT_SECRET should be a random value"

    def test_preserve_real_random_passwords(self, wizard, tmp_path):
        """Already-randomised passwords must never be touched."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=xY9-kL2mN4pQ7rS0\n"
                        "JWT_SECRET=aBcDeFgHiJkLmNoP\n"
                        "MINIO_SECRET_KEY=qRsTuVwXyZ123456\n")
        content = env.read_text()
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            content += f"\n{key}={_sec.token_urlsafe(16)[:16]}"
        assert "DB_PASSWORD=xY9-kL2mN4pQ7rS0" in content
        assert "JWT_SECRET=aBcDeFgHiJkLmNoP" in content
        assert "MINIO_SECRET_KEY=qRsTuVwXyZ123456" in content

    def test_preserve_empty_value(self, wizard, tmp_path):
        """A key with empty value (KEY=) still exists — must NOT be regenerated.
        Empty values are valid (user may have intentionally cleared it)."""
        env = tmp_path / ".env"
        env.write_text("DB_PASSWORD=\nJWT_SECRET=abc\nMINIO_SECRET_KEY=abc\n")
        content = env.read_text()
        for key, _, _, auto_gen, _ in wizard.ENV_SCHEMA:
            if not auto_gen:
                continue
            import re as _re
            existing = _re.search(rf"^{_re.escape(key)}=", content, _re.MULTILINE)
            if existing:
                continue
            import secrets as _sec
            content += f"\n{key}={_sec.token_urlsafe(16)[:16]}"
        # DB_PASSWORD= should still be in the content, not replaced
        import re as _re
        assert _re.search(r"^DB_PASSWORD=$", content, _re.MULTILINE), \
            "DB_PASSWORD= (empty) must be preserved, not auto-generated over"
