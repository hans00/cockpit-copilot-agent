# SPDX-License-Identifier: LGPL-2.1-or-later
import subprocess
from typing import Dict, List


async def list_units() -> List[Dict[str, str]]:
    """List all units loaded active"""
    cmd = ["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend"]
    result = subprocess.run(cmd, capture_output=True, text=True)

    units = []
    for line in result.stdout.splitlines():
        parts = line.split(maxsplit=4)
        if len(parts) >= 1:
            unit_name = parts[0]
            status = parts[2] if len(parts) > 2 else "unknown"
            desc = parts[4] if len(parts) > 4 else ""
            units.append({"unit": unit_name, "status": status, "description": desc})
    return units

async def get_status(unit: str) -> str:
    """Get detailed status of a unit"""
    cmd = ["systemctl", "status", unit, "--no-pager", "-l"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # Return stdout even if failed (e.g. unit not loaded)
    return result.stdout or result.stderr

async def manage_service(unit: str, action: str) -> str:
    """Start/stop/restart/enable/disable a unit"""
    allowed_actions = ["start", "stop", "restart", "reload", "enable", "disable"]
    if action not in allowed_actions:
        raise ValueError(f"Invalid action: {action}")

    cmd = ["systemctl", action, unit]
    # This might fail if not root, but permissions.py checks that before calling
    # However we should handle errors gracefully
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        return f"Error: {result.stderr}"
    return f"Successfully executed {action} on {unit}"
