import shutil
import subprocess
from typing import List

PACKAGE_MANAGERS = {
    "dnf": {"install": ["dnf", "install", "-y"], "remove": ["dnf", "remove", "-y"], "search": ["dnf", "search"]},
    "apt-get": {"install": ["apt-get", "install", "-y"], "remove": ["apt-get", "remove", "-y"], "search": ["apt-cache", "search"]},
    "zypper": {"install": ["zypper", "install", "-y"], "remove": ["zypper", "remove", "-y"], "search": ["zypper", "search"]},
}

def get_package_manager():
    for pm in PACKAGE_MANAGERS:
        if shutil.which(pm):
            return pm, PACKAGE_MANAGERS[pm]
    raise RuntimeError("No supported package manager found (dnf, apt-get, zypper).")

async def search(query: str) -> str:
    pm_name, cmds = get_package_manager()
    cmd = cmds["search"] + [query]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout

async def install(packages: List[str]) -> str:
    pm_name, cmds = get_package_manager()
    cmd = cmds["install"] + packages
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return f"Error installing packages: {result.stderr}"
    return result.stdout

async def remove(packages: List[str]) -> str:
    pm_name, cmds = get_package_manager()
    cmd = cmds["remove"] + packages
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return f"Error removing packages: {result.stderr}"
    return result.stdout
