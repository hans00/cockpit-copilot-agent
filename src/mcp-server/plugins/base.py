from abc import ABC, abstractmethod
from typing import List, Any, Dict

class ToolPlugin(ABC):
    """
    Abstract base class for system tool plugins.
    Plugins are auto-discovered and enabled if their prerequisites are met.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the plugin (e.g. 'vm', 'container', 'fs')"""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Brief description of what the plugin provides"""
        pass

    @abstractmethod
    def detect(self) -> bool:
        """
        Check if the plugin's prerequisites are met on this system.
        Returns True if the tools should be enabled.
        """
        pass

    @abstractmethod
    def get_tools(self) -> List[Dict[str, Any]]:
        """
        Return a list of MCP tool definitions provided by this plugin.
        Each tool definition should follow the MCP Tool schema.
        """
        pass

    @abstractmethod
    def execute(self, tool_name: str, args: Dict[str, Any]) -> Any:
        """
        Execute a tool provided by this plugin.
        Raises ValueError if tool_name is not handled.
        """
        pass
