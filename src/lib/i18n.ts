/* SPDX-License-Identifier: LGPL-2.1-or-later */

// Helper for Cockpit i18n
// @ts-expect-error: cockpit is global from cockpit.js
const cockpit = window.cockpit;

export const _ = (str: string, ...args: unknown[]): string => {
    if (cockpit && cockpit.gettext) {
        const res = cockpit.gettext(str);
        if (args.length > 0 && cockpit.format) {
            return cockpit.format(res, ...args);
        }
        return res;
    }
    // Fallback for non-cockpit environments (tests)
    return str;
};

// Also export raw gettext if needed
export const gettext = (str: string) => cockpit?.gettext ? cockpit.gettext(str) : str;
