/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function run(command: string): Promise<string> {
    return await cockpit.spawn(
        ["/bin/sh", "-c", command],
        { binary: false }
    );
}
