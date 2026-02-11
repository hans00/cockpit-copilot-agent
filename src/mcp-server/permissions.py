# SPDX-License-Identifier: LGPL-2.1-or-later
# Tools that require root privileges
ROOT_REQUIRED_TOOLS = {
    "service_action",
    "package_install",
    "package_remove",
    "network_modify",
    "user_add",
    "zvol_create",
    "container_run",
    "container_create",
    "container_start",
    "container_stop",
    "container_rm",
    "vm_create",
    # file_write depends on path, handled in tool
}

def is_tool_allowed(tool_name, user_privilege):
    """
    Check if a tool is allowed for the given user privilege level.
    """
    if user_privilege == "admin":
        return True

    if tool_name in ROOT_REQUIRED_TOOLS:
        return False

    return True
