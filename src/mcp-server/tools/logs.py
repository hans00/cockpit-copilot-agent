import subprocess
from typing import Optional

async def query_journal(service: Optional[str] = None, lines: int = 50) -> str:
    cmd = ["journalctl", "--no-pager", "-n", str(lines)]
    if service:
        cmd.extend(["-u", service])
        
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout
    except Exception as e:
        return f"Error querying journal: {e}"
