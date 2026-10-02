/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { run as runCommand } from "./exec.js";

export async function run(command: string): Promise<string> {
    return await runCommand(["/bin/sh", "-c", command]);
}

// sudo
export async function sudo(runAs: string, command: string): Promise<string> {
    return await runCommand(
        ["sudo", "-u", runAs, "sh", "-c", command],
        { superuser: "require" }
    );
}
