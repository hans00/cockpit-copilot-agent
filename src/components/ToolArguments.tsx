/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React from 'react';
import { DescriptionList, DescriptionListTerm, DescriptionListGroup, DescriptionListDescription } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

interface ToolArgumentsProps {
    args: Record<string, unknown>;
}

export const ToolArguments: React.FC<ToolArgumentsProps> = ({ args }) => {
    if (!args || Object.keys(args).length === 0) {
        return null;
    }

    return (
        <DescriptionList isCompact isHorizontal>
            {Object.entries(args).map(([key, value]) => (
                <DescriptionListGroup key={key}>
                    <DescriptionListTerm>{key}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            ))}
        </DescriptionList>
    );
};
