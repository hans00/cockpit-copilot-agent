import sys
import argparse
import asyncio
from mcp.server.stdio import stdio_server

from .server import serve

def main():
    parser = argparse.ArgumentParser(description="Cockpit Copilot MCP Server")
    parser.add_argument("--permissions", default="user", choices=["user", "admin"], help="Effective privilege level")
    args = parser.parse_args()

    # In Cockpit, we communicate over stdin/stdout
    # The server logic is in server.py
    asyncio.run(serve())

if __name__ == "__main__":
    main()
