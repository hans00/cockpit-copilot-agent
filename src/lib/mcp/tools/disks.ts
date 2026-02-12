/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function listDisks() {
    const result = await cockpit.spawn(["lsblk", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT"]);
    return result;
}
