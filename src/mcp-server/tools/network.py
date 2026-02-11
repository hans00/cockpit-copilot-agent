import subprocess
import shutil

async def get_info() -> str:
    """Get ip addr output"""
    try:
        return subprocess.check_output(["ip", "-brief", "address"]).decode()
    except Exception as e:
        return f"Error getting network info: {e}"

async def download_file(url: str, dest: str) -> str:
    """Download file using curl or wget"""
    if shutil.which("curl"):
        cmd = ["curl", "-L", "-o", dest, url]
    elif shutil.which("wget"):
        cmd = ["wget", "-O", dest, url]
    else:
        return "Error: neither curl nor wget found."
        
    try:
        # This will block the server! For large files we need async execution or a background job.
        # But for now, let's run it. In production, this should be a background task with progress reporting.
        subprocess.run(cmd, check=True)
        return f"Successfully downloaded {url} to {dest}"
    except subprocess.CalledProcessError as e:
        return f"Error downloading file: {e}"
