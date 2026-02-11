# SPDX-License-Identifier: LGPL-2.1-or-later
import shutil
import subprocess
from typing import Any, Dict, List

from .base import ToolPlugin


class FilesystemPlugin(ToolPlugin):
    @property
    def name(self) -> str:
        return "filesystems"

    @property
    def description(self) -> str:
        return "Filesystem & Disk management (ZFS, SMART)"

    def detect(self) -> bool:
        # Always available for lsblk
        return True

    def get_tools(self) -> List[Dict[str, Any]]:
        tools = [
            {
                "name": "disk_list",
                "description": "List block devices (lsblk)",
                "inputSchema": {"type": "object", "properties": {}}
            }
        ]

        if shutil.which("zpool"):
             tools.extend([
                 {
                    "name": "zpool_status",
                    "description": "Get ZFS pool status",
                    "inputSchema": {"type": "object", "properties": {}}
                 },
                 {
                    "name": "zfs_list",
                    "description": "List ZFS datasets and zvols",
                    "inputSchema": {"type": "object", "properties": {}}
                 },
                 {
                    "name": "zvol_create",
                    "description": "Create a ZFS volume (zvol)",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "pool": {"type": "string", "description": "Pool name"},
                            "name": {"type": "string", "description": "Volume name"},
                            "size": {"type": "string", "description": "Size (e.g. 10G)"},
                            "blocksize": {"type": "string", "description": "Block size (optional, e.g. 64k)"}
                        },
                        "required": ["pool", "name", "size"]
                    }
                 }
             ])

        if shutil.which("smartctl"):
            tools.append({
                "name": "smart_health",
                "description": "Check SMART health of a disk",
                "inputSchema": {
                    "type": "object",
                    "properties": {"device": {"type": "string", "description": "Device path (e.g. /dev/sda)"}},
                    "required": ["device"]
                }
            })

        return tools

    def execute(self, tool_name: str, args: Dict[str, Any]) -> Any:
        if tool_name == "disk_list":
            return self._run(["lsblk", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT"])

        elif tool_name == "zpool_status":
            return self._run(["zpool", "status"])

        elif tool_name == "zfs_list":
            return self._run(["zfs", "list"])

        elif tool_name == "zvol_create":
            # zfs create -V 10G -o volblocksize=64k pool/name
            cmd = ["zfs", "create", "-V", args["size"]]
            if args.get("blocksize"):
                cmd.extend(["-o", f"volblocksize={args['blocksize']}"])
            full_name = f"{args['pool']}/{args['name']}"
            cmd.append(full_name)
            return self._run(cmd)

        elif tool_name == "smart_health":
            # smartctl -H /dev/sda
            return self._run(["smartctl", "-H", args["device"]])

        else:
            raise ValueError(f"Unknown tool: {tool_name}")

    def _run(self, cmd: List[str]) -> str:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            return f"Error running {cmd[0]}: {e.stderr}"
