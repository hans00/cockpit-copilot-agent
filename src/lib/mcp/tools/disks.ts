/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { run } from "./exec.js";

export async function listDisks() {
    return await run(["lsblk", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT"]);
}
