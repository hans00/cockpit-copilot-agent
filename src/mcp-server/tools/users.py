# SPDX-License-Identifier: LGPL-2.1-or-later
import subprocess


async def list_users() -> str:
    """List normal users (UID >= 1000)"""
    try:
        # getent passwd
        output = subprocess.check_output(["getent", "passwd"]).decode()
        users = []
        for line in output.splitlines():
            parts = line.split(":")
            uid = int(parts[2])
            if uid >= 1000 and uid < 65534: # 65534 is usually nobody
                users.append(parts[0])
        return "\n".join(users)
    except Exception as e:
        return f"Error listing users: {e}"

async def add_user(username: str) -> str:
    try:
        subprocess.run(["useradd", "-m", username], check=True, capture_output=True)
        return f"User {username} added successfully."
    except subprocess.CalledProcessError as e:
         return f"Error adding user: {e.stderr.decode()}"
