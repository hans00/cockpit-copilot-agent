from mcp.server import Server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource
import logging
import asyncio

# Core tools imports
from .tools import systemd, packages, files, network, users, logs

# Plugin discovery
from .plugins import discover_plugins

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_server")

async def serve():
    app = Server("cockpit-copilot-server")

    # --- Register Core Tools ---
    # These are always available (or checked individually)
    
    # Systemd
    @app.tool()
    async def service_list():
        """List all systemd units"""
        return await systemd.list_units()

    @app.tool()
    async def service_status(unit: str):
        """Get status of a systemd unit"""
        return await systemd.get_status(unit)

    @app.tool()
    async def service_action(unit: str, action: str):
        """Start/stop/restart/enable/disable a systemd unit (requires root)"""
        return await systemd.manage_service(unit, action)

    # Packages
    @app.tool()
    async def package_search(query: str):
        """Search available packages"""
        return await packages.search(query)

    @app.tool()
    async def package_install(packages_list: list[str]):
        """Install packages (requires root)"""
        return await packages.install(packages_list)

    @app.tool()
    async def package_remove(packages_list: list[str]):
        """Remove packages (requires root)"""
        return await packages.remove(packages_list)

    # Files
    @app.tool()
    async def file_read(path: str):
        """Read file contents"""
        return await files.read_file(path)

    @app.tool()
    async def file_write(path: str, content: str):
        """Write content to a file (requires root/permission)"""
        return await files.write_file(path, content)

    @app.tool()
    async def file_list(path: str):
        """List directory contents"""
        return await files.list_dir(path)

    # Network
    @app.tool()
    async def network_info():
        """Show network interfaces and IPs"""
        return await network.get_info()

    @app.tool()
    async def file_download(url: str, dest: str):
        """Download a file from a URL to a local path"""
        return await network.download_file(url, dest)

    # Users
    @app.tool()
    async def user_list():
        """List system users"""
        return await users.list_users()

    @app.tool()
    async def user_add(username: str):
        """Create a new user (requires root)"""
        return await users.add_user(username)

    # Logs
    @app.tool()
    async def journal_query(service: str = None, lines: int = 50):
        """Query system logs (journalctl)"""
        return await logs.query_journal(service, lines)

    # System Info
    @app.tool()
    async def system_info():
        """Get system hostname, OS, kernel, uptime"""
        # implementation inline or separate module
        import subprocess
        try:
             hostname = subprocess.check_output(["hostname"]).decode().strip()
             uptime = subprocess.check_output(["uptime", "-p"]).decode().strip()
             return [TextContent(type="text", text=f"Hostname: {hostname}\nUptime: {uptime}")]
        except Exception as e:
             return [TextContent(type="text", text=f"Error: {e}")]

    # --- Register Plugin Tools ---
    active_plugins = discover_plugins()
    for plugin in active_plugins:
        logger.info(f"Registering tools for plugin: {plugin.name}")
        
        # We need to dynamically register tools from plugins.
        # MCPServer requires decorators, but we can also add manually if the SDK supports it.
        # The python MCP SDK uses `app.tool()` decorator which registers into an internal registry.
        # We can iterate plugin.get_tools() and register wrapper functions.
        
        for tool_def in plugin.get_tools():
            tool_name = tool_def["name"]
            tool_desc = tool_def.get("description", "")
            
            # Create a closure to capture tool_name and plugin
            async def wrapper(plugin=plugin, tool_name=tool_name, **kwargs):
                return await plugin.execute(tool_name, kwargs)
            
            # Set metadata
            wrapper.__name__ = tool_name
            wrapper.__doc__ = tool_desc
            
            # Register with the app
            app.tool()(wrapper)


    # Run the server via stdio
    from mcp.server.stdio import stdio_server
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

