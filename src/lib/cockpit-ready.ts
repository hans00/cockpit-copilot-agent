/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

let initialization: Promise<void> | undefined;

export function ensureCockpitReady(): Promise<void> {
    if (!initialization)
        initialization = cockpit.init();
    return initialization;
}
