import shutil
import subprocess
from typing import List, Dict, Any
from .base import ToolPlugin

class ContainerPlugin(ToolPlugin):
    def __init__(self):
        self.runtime = None

    @property
    def name(self) -> str:
        return "containers"

    @property
    def description(self) -> str:
        return "Container management (podman/docker)"

    def detect(self) -> bool:
        if shutil.which("podman"):
            self.runtime = "podman"
            return True
        if shutil.which("docker"):
            self.runtime = "docker"
            return True
        return False

    def get_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "container_list",
                "description": "List containers (running and stopped)",
                "inputSchema": {"type": "object", "properties": {}}
            },
            {
                "name": "container_inspect",
                "description": "Inspect a container",
                "inputSchema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"]
                }
            },
            {
                "name": "container_logs",
                "description": "Get logs of a container",
                "inputSchema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"]
                }
            },
            {
                "name": "container_start",
                "description": "Start a container",
                "inputSchema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"]
                }
            },
            {
                "name": "container_stop",
                "description": "Stop a container",
                "inputSchema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"]
                }
            },
             {
                "name": "container_rm",
                "description": "Remove a container",
                "inputSchema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"]
                }
            },
             {
                "name": "container_run",
                "description": "Run a new container",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "image": {"type": "string", "description": "Image name (e.g. alpine:latest)"},
                        "name": {"type": "string", "description": "Container name (optional)"},
                        "ports": {"type": "array", "items": {"type": "string"}, "description": "Port mappings (e.g. 8080:80)"},
                        "vols": {"type": "array", "items": {"type": "string"}, "description": "Volume mappings (e.g. /host:/container)"},
                        "env": {"type": "array", "items": {"type": "string"}, "description": "Environment variables (e.g. KEY=VAL)"},
                        "detach": {"type": "boolean", "description": "Run in background (default true)"}
                    },
                    "required": ["image"]
                }
            },
            {
                "name": "image_list",
                "description": "List container images",
                "inputSchema": {"type": "object", "properties": {}}
            }
        ]

    def execute(self, tool_name: str, args: Dict[str, Any]) -> Any:
        # Check permissions for modifying actions? handled in permissions.py map
        
        if tool_name == "container_list":
            return self._run([self.runtime, "ps", "-a", "--format", "{{.ID}} {{.Names}} {{.Image}} {{.Status}}"])
        elif tool_name == "container_inspect":
            return self._run([self.runtime, "inspect", args["name"]])
        elif tool_name == "container_logs":
            return self._run([self.runtime, "logs", "--tail", "50", args["name"]])
        elif tool_name == "container_start":
            return self._run([self.runtime, "start", args["name"]])
        elif tool_name == "container_stop":
            return self._run([self.runtime, "stop", args["name"]])
        elif tool_name == "container_rm":
            return self._run([self.runtime, "rm", args["name"]])
        elif tool_name == "image_list":
            return self._run([self.runtime, "images"])
        elif tool_name == "container_run":
            cmd = [self.runtime, "run"]
            if args.get("detach", True):
                cmd.append("-d")
            if args.get("name"):
                cmd.extend(["--name", args["name"]])
            for p in args.get("ports", []):
                cmd.extend(["-p", p])
            for v in args.get("vols", []):
                cmd.extend(["-v", v])
            for e in args.get("env", []):
                cmd.extend(["-e", e])
            cmd.append(args["image"])
            return self._run(cmd)
        else:
             raise ValueError(f"Unknown tool: {tool_name}")

    def _run(self, cmd: List[str]) -> str:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            return f"Error running {cmd[0]}: {e.stderr}"
