/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React from 'react';
import type { ApprovalPreview as Preview } from "../lib/agent.js";
import { _ } from "../lib/i18n.js";

const MAX_PREVIEW_LINES = 400;

const PREFIX = { add: "+ ", remove: "- ", context: "  ", skip: "… " } as const;

export const ApprovalPreview: React.FC<{ preview: Preview }> = ({ preview }) => {
    if (preview.kind === "unavailable")
        return <div className="copilot-diff-note">{preview.message}</div>;

    const changed = preview.lines.filter(line => line.type === "add" || line.type === "remove").length;
    const shown = preview.lines.slice(0, MAX_PREVIEW_LINES);
    return (
        <div>
            <div className="copilot-diff-note">
                {preview.isNewFile
                    ? _("New file $0", preview.path)
                    : changed === 0
                        ? _("No changes to $0", preview.path)
                        : _("Changes to $0", preview.path)}
            </div>
            {shown.length > 0 && (
                <pre className="copilot-diff">
                    {shown.map((line, index) => (
                        <div key={index} className={`copilot-diff-${line.type}`}>
                            {PREFIX[line.type]}{line.text}
                        </div>
                    ))}
                    {preview.lines.length > shown.length && (
                        <div className="copilot-diff-skip">
                            {_("$0 more lines not shown", preview.lines.length - shown.length)}
                        </div>
                    )}
                </pre>
            )}
        </div>
    );
};
