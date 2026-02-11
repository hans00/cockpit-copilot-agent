# SPDX-License-Identifier: LGPL-2.1-or-later
import os

MAX_READ_SIZE = 100 * 1024 # 100KB limit for now to avoid huge output

async def read_file(path: str) -> str:
    if not os.path.exists(path):
        return f"Error: File not found: {path}"

    try:
        size = os.path.getsize(path)
        if size > MAX_READ_SIZE:
             return f"Error: File too large to read (>{MAX_READ_SIZE} bytes)"

        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {e}"

async def write_file(path: str, content: str) -> str:
    try:
        # Basic security check - in future we might want to restrict allowed paths
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"Successfully wrote to {path}"
    except Exception as e:
        return f"Error writing file: {e}"

async def list_dir(path: str) -> str:
    if not os.path.exists(path):
        return f"Error: Path not found: {path}"

    try:
        items = os.listdir(path)
        output = []
        for item in items:
            item_path = os.path.join(path, item)
            is_dir = os.path.isdir(item_path)
            type_char = "d" if is_dir else "-"
            output.append(f"{type_char} {item}")
        return "\n".join(output)
    except Exception as e:
        return f"Error listing directory: {e}"
