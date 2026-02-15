/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataListAction } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { PlusIcon, TrashIcon, CommentIcon } from '@patternfly/react-icons';
import { css } from '@patternfly/react-styles';
import { _ } from "../lib/i18n.js";
import { ChatSession, ChatSessionSummary } from "../lib/types.js";

interface ChatHistorySidebarProps {
    history: ChatSessionSummary[];
    currentChatId: string | null;
    onSelectChat: (id: string) => void;
    onCreateChat: () => void;
    onDeleteChat: (id: string, e: React.MouseEvent) => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
    history,
    currentChatId,
    onSelectChat,
    onCreateChat,
    onDeleteChat
}) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--pf-v6-global--BorderColor--100)' }}>
                <Button 
                    variant="primary" 
                    isBlock 
                    icon={<PlusIcon />}
                    onClick={onCreateChat}
                >
                    {_("New Chat")}
                </Button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {history.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--pf-v6-global--Color--200)' }}>
                        {_("No history yet")}
                    </div>
                ) : (
                    <DataList aria-label={_("Chat History")} isCompact>
                        {history.map(session => (
                            <DataListItem 
                                key={session.id} 
                                aria-labelledby={`chat-${session.id}`}
                                className={session.id === currentChatId ? "pf-m-selected" : ""}
                                onClick={() => onSelectChat(session.id)}
                            >
                                <DataListItemRow>
                                    <DataListItemCells
                                        dataListCells={[
                                            <DataListCell key="primary">
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <CommentIcon style={{ marginRight: '0.5rem', color: 'var(--pf-v6-global--Color--200)' }} />
                                                    <span 
                                                        id={`chat-${session.id}`}
                                                        style={{ 
                                                            fontWeight: session.id === currentChatId ? 'bold' : 'normal',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            maxWidth: '180px'
                                                        }}
                                                    >
                                                        {session.title || _("Untitled Chat")}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--pf-v6-global--Color--200)', marginLeft: '1.5rem' }}>
                                                    {new Date(session.lastModified).toLocaleDateString()}
                                                </div>
                                            </DataListCell>
                                        ]}
                                    />
                                    <DataListAction
                                        aria-labelledby={`delete-${session.id}`}
                                        id={`delete-action-${session.id}`}
                                        aria-label={_("Actions")}
                                    >
                                        <Button
                                            variant="plain"
                                            aria-label={_("Delete chat")}
                                            onClick={(e) => onDeleteChat(session.id, e)}
                                        >
                                            <TrashIcon />
                                        </Button>
                                    </DataListAction>
                                </DataListItemRow>
                            </DataListItem>
                        ))}
                    </DataList>
                )}
            </div>
        </div>
    );
};
