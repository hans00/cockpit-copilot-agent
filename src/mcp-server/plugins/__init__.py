import importlib
import pkgutil
import logging
from typing import List, Dict, Any
from .base import ToolPlugin

logger = logging.getLogger(__name__)

def discover_plugins() -> List[ToolPlugin]:
    """
    Discover and initialize all available plugins in the package.
    Only returns plugins whose detect() method returns True.
    """
    active_plugins = []
    
    # Import all modules in the current package
    package_name = __name__
    package_path = __commands__path__ if hasattr(__commands__, "__path__") else None

    # We know our plugins are in the same directory, import them manually for now 
    # to avoid complex dynamic importing in this environment if pkgutil fails
    plugin_modules = ['vm', 'containers', 'filesystems']

    for module_name in plugin_modules:
        try:
            # Dynamic import: .vm, .containers, etc.
            module = importlib.import_module(f".{module_name}", package_name)
            
            # Find subclasses of ToolPlugin in the module
            for attribute_name in dir(module):
                attribute = getattr(module, attribute_name)
                
                if (isinstance(attribute, type) and 
                    issubclass(attribute, ToolPlugin) and 
                    attribute is not ToolPlugin):
                    
                    # Instantiate and check prerequisites
                    try:
                        plugin = attribute()
                        if plugin.detect():
                            logger.info(f"Plugin enabled: {plugin.name}")
                            active_plugins.append(plugin)
                        else:
                            logger.info(f"Plugin skipped (prereqs not met): {plugin.name}")
                    except Exception as e:
                        logger.error(f"Error initializing plugin {attribute_name}: {e}")

        except ImportError as e:
            logger.warning(f"Could not import plugin module {module_name}: {e}")
            continue

    return active_plugins
