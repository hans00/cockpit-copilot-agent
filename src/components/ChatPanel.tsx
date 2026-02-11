/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useState, useEffect, useRef } from 'react';
import Chatbot, { ChatbotDisplayMode } from '@patternfly/chatbot/dist/dynamic/Chatbot';
import ChatbotContent from '@patternfly/chatbot/dist/dynamic/ChatbotContent';
import ChatbotFooter from '@patternfly/chatbot/dist/dynamic/ChatbotFooter';
import MessageBox from '@patternfly/chatbot/dist/dynamic/MessageBox';
import Message from '@patternfly/chatbot/dist/dynamic/Message';
import MessageBar from '@patternfly/chatbot/dist/dynamic/MessageBar';
import ToolCall from '@patternfly/chatbot/dist/dynamic/ToolCall';
import ToolResponse from '@patternfly/chatbot/dist/dynamic/ToolResponse';
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { RobotIcon } from '@patternfly/react-icons';
import { ChatMessage } from "../lib/types.js";
import type { Agent } from "../lib/agent.js";
import { _ } from "../lib/i18n.js";

import "@patternfly/chatbot/dist/css/main.css";

interface ChatPanelProps {
    agent: Agent;
    messages: ChatMessage[];
    isProcessing: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ agent, messages, isProcessing }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom when messages change
    useEffect(() => {
        if (messages.length > 0 || agent.pendingApprovals.length > 0) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, agent.pendingApprovals, isProcessing]);

    const handleSendMessage = async (message: string) => {
        if (!message.trim()) return;
        await agent.addUserMessage(message);
    };

    const hasPendingApprovals = agent.pendingApprovals.length > 0;

    return (
        <Chatbot displayMode={ChatbotDisplayMode.embedded}>
            <ChatbotContent>
                {messages.length === 0 ? (
                    <EmptyState>
                        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                            <RobotIcon style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--pf-v6-global--Color--200)' }} />
                            <h4 className="pf-v6-c-title pf-m-lg">{_("Cockpit Copilot")}</h4>
                        </div>
                        <EmptyStateBody>
                            {_("Hi! I'm your system agent using MCP. Ask me to manage services, install packages, or check system logs.")}
                        </EmptyStateBody>
                    </EmptyState>
                ) : (
                    <MessageBox>
                        {messages.map((msg) => {
                            if (msg.role === 'tool') {
                                const toolName = agent.getToolDisplayName(msg.toolResult?.name || "");
                                return (
                                    <ToolResponse
                                        key={msg.id}
                                        toggleContent={<>{_("Tool Calling")}: <strong>{toolName}</strong></>}
                                        body={(
                                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                                                {msg.content || msg.toolResult?.output || ""}
                                            </pre>
                                        )}
                                        isBodyMarkdown={false}
                                        isDefaultExpanded={false}
                                    />
                                );
                            }

                            return (
                                <Message
                                    key={msg.id}
                                    role={msg.role === 'user' ? 'user' : 'bot'}
                                    content={msg.content}
                                    name={msg.role === 'user' ? _("You") : _("Copilot")}
                                />
                            );
                        })}

                        {/* Pending Approvals */}
                        {agent.pendingApprovals.map((approval) => (
                             <ToolCall
                                key={approval.toolCall.id}
                                titleText={`${_("Tool Approval Required")}: ${agent.getToolDisplayName(approval.toolCall.function.name)}`}
                                runButtonText={_("Approve & Run")}
                                cancelButtonText={_("Reject")}
                                runButtonProps={{
                                    onClick: () => agent.approveToolCall(approval.toolCall.id)
                                }}
                                cancelButtonProps={{
                                    onClick: () => agent.rejectToolCall(approval.toolCall.id)
                                }}
                                expandableContent={
                                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                                        {JSON.stringify(JSON.parse(approval.toolCall.function.arguments), null, 2)}
                                    </pre>
                                }
                                isDefaultExpanded
                            />
                        ))}

                        {isProcessing && !hasPendingApprovals && (
                             <Message role="bot" isLoading loadingWord={_("Thinking...")} />
                        )}
                        <div ref={bottomRef} />
                    </MessageBox>
                )}
            </ChatbotContent>
            <ChatbotFooter>
                <MessageBar
                    onSendMessage={(msg) => handleSendMessage(String(msg))}
                    placeholder={_("Type a command or ask a question...")}
                    isSendButtonDisabled={isProcessing || hasPendingApprovals}
                    hasAttachButton={false} // Disable attachments for now as logic isn't ported
                />
            </ChatbotFooter>
        </Chatbot>
    );
};
