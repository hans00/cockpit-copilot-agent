import shutil
import subprocess
import logging
from typing import List, Dict, Any
from .base import ToolPlugin

logger = logging.getLogger(__name__)

class VmPlugin(ToolPlugin):
    @property
    def name(self) -> str:
        return "vm"

    @property
    def description(self) -> str:
        return "Virtual Machine management (libvirt/virsh)"

    def detect(self) -> bool:
        """Check for virsh and virt-install"""
        return shutil.which("virsh") is not None

    def get_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "vm_list",
                "description": "List all VMs with state (running, shut off)",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                }
            },
            {
                "name": "vm_info",
                "description": "Get detailed info about a specific VM",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Name of the VM"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "vm_start",
                "description": "Start a VM",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "vm_stop",
                "description": "Shutdown a VM gracefully",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "vm_reboot",
                "description": "Reboot a VM",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"}
                    },
                    "required": ["name"]
                }
            },
             {
                "name": "vm_snapshot_list",
                "description": "List snapshots of a VM",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                         "name": {"type": "string"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "vm_create",
                "description": "Create a new VM using virt-install (requires root)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "VM Name"},
                        "vcpu": {"type": "integer", "description": "Number of vCPUs"},
                        "ram_mb": {"type": "integer", "description": "RAM in MB"},
                        "disk_path": {"type": "string", "description": "Path to disk image or zvol (e.g. /dev/zvol/pool/name)"},
                        "iso_path": {"type": "string", "description": "Path to installer ISO"},
                        "os_variant": {"type": "string", "description": "OS variant (e.g. ubuntu22.04), optional"}
                    },
                    "required": ["name", "vcpu", "ram_mb", "disk_path", "iso_path"]
                }
            }
        ]

    def execute(self, tool_name: str, args: Dict[str, Any]) -> Any:
        if tool_name == "vm_list":
            return self._run_virsh(["list", "--all"])
        elif tool_name == "vm_info":
            return self._run_virsh(["dominfo", args["name"]])
        elif tool_name == "vm_start":
            return self._run_virsh(["start", args["name"]])
        elif tool_name == "vm_stop":
            return self._run_virsh(["shutdown", args["name"]])
        elif tool_name == "vm_reboot":
            return self._run_virsh(["reboot", args["name"]])
        elif tool_name == "vm_snapshot_list":
             return self._run_virsh(["snapshot-list", args["name"]])
        elif tool_name == "vm_create":
            return self._create_vm(args)
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

    def _run_virsh(self, cmd_args: List[str]) -> str:
        cmd = ["virsh"] + cmd_args
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            return f"Error running virsh: {e.stderr}"

    def _create_vm(self, args: Dict[str, Any]) -> str:
        if not shutil.which("virt-install"):
            return "Error: virt-install is not installed."
            
        cmd = [
            "virt-install",
            "--name", args["name"],
            "--vcpus", str(args["vcpu"]),
            "--memory", str(args["ram_mb"]),
            "--disk", f"path={args['disk_path']}",
            "--cdrom", args["iso_path"],
            "--os-variant", args.get("os_variant", "generic"),
            "--noautoconsole", # Don't try to open console viewer
            "--graphics", "vnc" # Use VNC graphics
        ]
        
        try:
            # this takes time, but it backgrounds almost immediately unless waiting for install?
            # virt-install with --noautoconsole returns quickly after starting the VM setup
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return f"VM creation started successfully:\n{result.stdout}"
        except subprocess.CalledProcessError as e:
            return f"Error creating VM: {e.stderr}"
