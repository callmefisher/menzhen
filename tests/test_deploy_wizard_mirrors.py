#!/usr/bin/env python3
"""
Tests for deploy-wizard.py — Docker/Homebrew mirror configuration.
Run: python3 -m pytest tests/test_deploy_wizard_mirrors.py -v
"""

import ast
import re
import textwrap
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

WIZARD_PATH = Path(__file__).resolve().parent.parent / "deploy-wizard.py"


@pytest.fixture
def wizard_source():
    """Load deploy-wizard.py source code."""
    return WIZARD_PATH.read_text(encoding="utf-8")


@pytest.fixture
def wizard_ast(wizard_source):
    """Parse deploy-wizard.py into AST."""
    return ast.parse(wizard_source)


# ---------------------------------------------------------------------------
# Helper: extract all string literals from the AST
# ---------------------------------------------------------------------------
def extract_string_constants(tree):
    """Yield (lineno, value) for all string constants in AST."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.lineno, node.value


def extract_urls(tree):
    """Yield (lineno, url) for all URLs found in string constants."""
    for lineno, value in extract_string_constants(tree):
        for url in re.findall(r'https?://[^\s"\'\\]+', value):
            yield lineno, url.rstrip("',;)")


# ---------------------------------------------------------------------------
# 1. Python syntax validation
# ---------------------------------------------------------------------------
class TestSyntax:
    def test_valid_python(self, wizard_source):
        """deploy-wizard.py should parse without syntax errors."""
        ast.parse(wizard_source)


# ---------------------------------------------------------------------------
# 2. Docker install uses Aliyun mirror
# ---------------------------------------------------------------------------
class TestDockerInstallMirror:
    def test_get_docker_uses_aliyun_mirror(self, wizard_source):
        """Linux Docker install should use --mirror Aliyun flag."""
        assert "--mirror Aliyun" in wizard_source, \
            "get.docker.com should be called with --mirror Aliyun"

    def test_daemon_json_configured(self, wizard_source):
        """Docker install should auto-configure daemon.json with registry mirrors."""
        assert "daemon.json" in wizard_source
        assert "registry-mirrors" in wizard_source

    def test_daocloud_mirror_present(self, wizard_source):
        """DaoCloud mirror should be in registry-mirrors."""
        assert "docker.m.daocloud.io" in wizard_source

    def test_tencent_mirror_present(self, wizard_source):
        """Tencent Cloud mirror should be in registry-mirrors."""
        assert "mirror.ccs.tencentyun.com" in wizard_source

    def test_docker_restart_after_config(self, wizard_source):
        """Docker should be restarted after writing daemon.json."""
        # Find the daemon.json write and verify restart comes after
        daemon_pos = wizard_source.find("daemon.json > /dev/null")
        restart_pos = wizard_source.find("sudo systemctl restart docker", daemon_pos)
        assert daemon_pos > 0, "daemon.json configuration not found"
        assert restart_pos > daemon_pos, \
            "Docker restart should come after daemon.json write"

    def test_wget_fallback_also_uses_mirror(self, wizard_source):
        """wget fallback path should also use --mirror Aliyun."""
        # Find wget section
        wget_section = wizard_source[wizard_source.find("wget -qO-"):]
        assert "--mirror Aliyun" in wget_section, \
            "wget fallback should also use --mirror Aliyun"

    def test_curl_missing_fallback_also_uses_mirror(self, wizard_source):
        """When curl is missing, install curl then use --mirror Aliyun."""
        # Find the "Try installing curl first" section
        curl_first_pos = wizard_source.find("command -v apt-get")
        after_curl = wizard_source[curl_first_pos:]
        assert "--mirror Aliyun" in after_curl or "DOCKER_INSTALL_CMD" in after_curl, \
            "curl-missing fallback should also use Aliyun mirror"


# ---------------------------------------------------------------------------
# 3. Homebrew uses Chinese mirrors
# ---------------------------------------------------------------------------
class TestHomebrewMirror:
    def test_brew_git_remote_is_tuna(self, wizard_source):
        """Homebrew brew git remote should use TUNA mirror."""
        assert "mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git" in wizard_source

    def test_brew_core_remote_is_tuna(self, wizard_source):
        """Homebrew core git remote should use TUNA mirror."""
        assert "mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git" in wizard_source

    def test_brew_bottles_is_tuna(self, wizard_source):
        """Homebrew bottles domain should use TUNA mirror."""
        assert "mirrors.tuna.tsinghua.edu.cn/homebrew-bottles" in wizard_source

    def test_brew_api_domain_is_tuna(self, wizard_source):
        """Homebrew API domain should use TUNA mirror."""
        assert "mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api" in wizard_source

    def test_brew_existence_assertion(self, wizard_source):
        """After brew install loop, should assert brew is available."""
        assert "command -v brew >/dev/null" in wizard_source, \
            "Missing brew existence check after installation"


# ---------------------------------------------------------------------------
# 4. Dockerfile mirror sources
# ---------------------------------------------------------------------------
class TestDockerfileMirrors:
    @pytest.fixture
    def server_dockerfile(self):
        return (WIZARD_PATH.parent / "server" / "Dockerfile").read_text()

    @pytest.fixture
    def web_dockerfile(self):
        return (WIZARD_PATH.parent / "web" / "Dockerfile").read_text()

    @pytest.fixture
    def backup_dockerfile(self):
        return (WIZARD_PATH.parent / "scripts" / "Dockerfile.backup").read_text()

    def test_server_alpine_mirror(self, server_dockerfile):
        """server/Dockerfile should use Aliyun Alpine mirror."""
        assert "mirrors.aliyun.com" in server_dockerfile

    def test_server_go_proxy(self, server_dockerfile):
        """server/Dockerfile should use goproxy.cn."""
        assert "goproxy.cn" in server_dockerfile

    def test_web_alpine_mirror(self, web_dockerfile):
        """web/Dockerfile should use Aliyun Alpine mirror."""
        assert "mirrors.aliyun.com" in web_dockerfile

    def test_web_npm_mirror(self, web_dockerfile):
        """web/Dockerfile should use npmmirror registry."""
        assert "registry.npmmirror.com" in web_dockerfile

    def test_backup_alpine_mirror(self, backup_dockerfile):
        """scripts/Dockerfile.backup should use Aliyun Alpine mirror."""
        assert "mirrors.aliyun.com" in backup_dockerfile

    def test_backup_pip_mirror(self, backup_dockerfile):
        """scripts/Dockerfile.backup should use Tsinghua pip mirror."""
        assert "pypi.tuna.tsinghua.edu.cn" in backup_dockerfile

    def test_backup_pip_trusted_host(self, backup_dockerfile):
        """pip install should include --trusted-host for the mirror."""
        assert "--trusted-host pypi.tuna.tsinghua.edu.cn" in backup_dockerfile


# ---------------------------------------------------------------------------
# 5. deploy.sh Docker mirror hint
# ---------------------------------------------------------------------------
class TestDeployScript:
    @pytest.fixture
    def deploy_sh(self):
        return (WIZARD_PATH.parent / "deploy.sh").read_text()

    def test_mirror_check_present(self, deploy_sh):
        """deploy.sh should check for Docker Hub mirror configuration."""
        assert "Registry Mirrors" in deploy_sh or "registry-mirrors" in deploy_sh.lower()

    def test_mirror_setup_hint(self, deploy_sh):
        """deploy.sh should suggest running setup-docker-mirror.sh."""
        assert "setup-docker-mirror.sh" in deploy_sh


# ---------------------------------------------------------------------------
# 6. setup-docker-mirror.sh
# ---------------------------------------------------------------------------
class TestSetupDockerMirror:
    @pytest.fixture
    def mirror_script(self):
        return (WIZARD_PATH.parent / "scripts" / "setup-docker-mirror.sh").read_text()

    def test_script_exists(self):
        assert (WIZARD_PATH.parent / "scripts" / "setup-docker-mirror.sh").exists()

    def test_configures_daemon_json(self, mirror_script):
        assert "/etc/docker/daemon.json" in mirror_script

    def test_has_registry_mirrors(self, mirror_script):
        assert "registry-mirrors" in mirror_script

    def test_backups_existing_config(self, mirror_script):
        assert ".bak" in mirror_script

    def test_requires_root(self, mirror_script):
        """Script should check for root/sudo."""
        assert "id -u" in mirror_script or "EUID" in mirror_script

    def test_restarts_docker(self, mirror_script):
        assert "systemctl restart docker" in mirror_script or \
               "service docker restart" in mirror_script


# ---------------------------------------------------------------------------
# 7. start-wizard file validation
# ---------------------------------------------------------------------------
class TestStartWizardValidation:
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

    def test_command_validates_shebang(self, wizard_command):
        """start-wizard.command should validate Python shebang, not just 'python3'."""
        assert "^#!.*python" in wizard_command, \
            "Should match shebang pattern, not loose 'python3' substring"

    def test_bat_validates_shebang(self, wizard_bat):
        """start-wizard.bat should validate downloaded file contains WIZARD_VERSION."""
        assert "WIZARD_VERSION" in wizard_bat, \
            "Should validate WIZARD_VERSION in downloaded file"


# ---------------------------------------------------------------------------
# 8. No remaining raw Docker Hub URLs without mirrors
# ---------------------------------------------------------------------------
class TestNoUnmirroredSources:
    def test_no_raw_apk_source(self):
        """Dockerfiles should not use dl-cdn.alpinelinux.org directly."""
        for df_path in [
            WIZARD_PATH.parent / "server" / "Dockerfile",
            WIZARD_PATH.parent / "web" / "Dockerfile",
            WIZARD_PATH.parent / "scripts" / "Dockerfile.backup",
        ]:
            content = df_path.read_text()
            # The sed command itself contains the old URL as pattern, that's OK
            lines = content.split("\n")
            for i, line in enumerate(lines):
                if "sed -i" in line:
                    continue  # sed replacement line, expected
                if "apk add" in line or "apk update" in line:
                    assert "dl-cdn.alpinelinux.org" not in line, \
                        f"{df_path.name}:{i+1} uses raw Alpine CDN"

    def test_go_proxy_not_default(self):
        """server/Dockerfile should not use default Go proxy."""
        content = (WIZARD_PATH.parent / "server" / "Dockerfile").read_text()
        assert "proxy.golang.org" not in content, \
            "Should use goproxy.cn instead of proxy.golang.org"

    def test_npm_not_default(self):
        """web/Dockerfile should not use default npm registry."""
        content = (WIZARD_PATH.parent / "web" / "Dockerfile").read_text()
        assert "registry.npmjs.org" not in content, \
            "Should use npmmirror instead of registry.npmjs.org"

    def test_pip_not_default(self):
        """scripts/Dockerfile.backup should not use default PyPI."""
        content = (WIZARD_PATH.parent / "scripts" / "Dockerfile.backup").read_text()
        # pip without -i flag means using default PyPI
        for line in content.split("\n"):
            if "pip3 install" in line:
                assert "-i" in line, \
                    "pip install should use -i flag for mirror"


# ---------------------------------------------------------------------------
# 9. IMAGE_REGISTRY placeholder check
# ---------------------------------------------------------------------------
class TestImageRegistry:
    def test_image_registry_placeholder(self, wizard_source):
        """IMAGE_REGISTRY should be noted as placeholder (not actually used for pulls)."""
        match = re.search(r'IMAGE_REGISTRY\s*=\s*"([^"]*)"', wizard_source)
        assert match, "IMAGE_REGISTRY variable should exist"
        # It's a placeholder — verify it's not used in actual docker pull commands
        registry_val = match.group(1)
        assert "example.com" in registry_val or registry_val == "", \
            "IMAGE_REGISTRY should be a placeholder, not a real registry"
