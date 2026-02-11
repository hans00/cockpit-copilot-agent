
// Helper for Cockpit i18n
// @ts-ignore
const cockpit = window.cockpit;

export const _ = (str: string, ...args: any[]): string => {
    if (cockpit && cockpit.gettext) {
        let res = cockpit.gettext(str);
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
