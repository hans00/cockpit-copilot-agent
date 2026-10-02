/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useEffect, useRef } from 'react';
import Chatbot, { ChatbotDisplayMode } from '@patternfly/chatbot/dist/dynamic/Chatbot';
import ChatbotContent from '@patternfly/chatbot/dist/dynamic/ChatbotContent';
import ChatbotFooter from '@patternfly/chatbot/dist/dynamic/ChatbotFooter';
import MessageBox from '@patternfly/chatbot/dist/dynamic/MessageBox';
import Message from '@patternfly/chatbot/dist/dynamic/Message';
import MessageBar from '@patternfly/chatbot/dist/dynamic/MessageBar';
import ToolCall from '@patternfly/chatbot/dist/dynamic/ToolCall';
import ToolResponse from '@patternfly/chatbot/dist/dynamic/ToolResponse';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateActions } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { RobotIcon, RedoIcon, PlayIcon } from '@patternfly/react-icons';
import { ToolArguments } from "./ToolArguments.jsx";
import { ApprovalPreview } from "./ApprovalPreview.jsx";
import { ChatMessage } from "../lib/types.js";
import type { Agent } from "../lib/agent.js";
import { diagnostics, type DiagnosticSpan } from "../lib/diagnostics.js";
import { _ } from "../lib/i18n.js";

import "@patternfly/chatbot/dist/css/main.css";

interface ChatPanelProps {
    agent: Agent;
    messages: ChatMessage[];
    isProcessing: boolean;
}

let startupTotalSpan: DiagnosticSpan | null = null;

/**
 * The app starts this span before Agent.init(), while ChatPanel is the only
 * module that can observe the mounted, usable MessageBar input.
 */
export const setStartupTotalSpan = (span: DiagnosticSpan | null): void => {
    startupTotalSpan = span;
};

export const finishStartupTotal = (status: "ready" | "error"): void => {
    if (!startupTotalSpan)
        return;

    const span = startupTotalSpan;
    startupTotalSpan = null;
    diagnostics.end(span, { status });
    if (status === "ready")
        diagnostics.record("startup.ready", { status: "ready" });
};

export const ChatPanel: React.FC<ChatPanelProps> = ({ agent, messages, isProcessing }) => {
    const bottomRef = useRef<HTMLDivElement>(null);
    const messageInputRef = useRef<HTMLTextAreaElement>(null);
    const chatMountedRecordedRef = useRef(false);
    const inputReadyRecordedRef = useRef(false);
    const hasPendingApprovals = agent.pendingApprovals.length > 0;

    const parseToolArguments = (value: string): Record<string, unknown> => {
        try {
            const parsed: unknown = JSON.parse(value);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
                return parsed as Record<string, unknown>;
            return {};
        } catch {
            return {};
        }
    };

    // Scroll to bottom when messages change
    useEffect(() => {
        if (messages.length > 0 || agent.pendingApprovals.length > 0) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, agent.pendingApprovals, isProcessing]);

    useEffect(() => {
        if (!diagnostics.isEnabled())
            return;

        if (!chatMountedRecordedRef.current) {
            chatMountedRecordedRef.current = true;
            diagnostics.record("startup.chat_mounted", { status: "ready" });
        }

        const recordInputReady = () => {
            const messageInput = messageInputRef.current;
            if (messageInput && !messageInput.disabled && !inputReadyRecordedRef.current) {
                inputReadyRecordedRef.current = true;
                diagnostics.record("startup.input_ready", { status: "ready" });
                finishStartupTotal("ready");
            }
        };

        // Refs are normally populated before effects run. The frame also
        // covers MessageBar implementations that assign the ref one frame
        // after the parent has mounted.
        recordInputReady();
        const frame = window.requestAnimationFrame(recordInputReady);

        return () => window.cancelAnimationFrame(frame);
    }, [hasPendingApprovals, isProcessing]);

    const handleSendMessage = async (message: string) => {
        if (!message.trim()) return;
        await agent.addUserMessage(message);
    };

    // Extract strings for translation to ensure xgettext picks them up
    const tCockpitCopilot = _("Cockpit Copilot");
    const tGreeting = _("Hi! I'm your system agent using MCP. Ask me to manage services, install packages, or check system logs, or start with one of these:");
    const tToolCalling = _("Tool Calling");
    const tYou = _("You");
    const tCopilot = _("Copilot");
    const tToolApprovalRequired = _("Tool Approval Required");
    const tApproveRun = _("Approve & Run");
    const tReject = _("Reject");
    const tThinking = _("Thinking...");
    const tPlaceholder = _("Type a command or ask a question...");

    const quickActions = [
        {
            label: _("Health check"),
            prompt: _("Run a read-only health check of this system: resources, disk usage, failed services, recent errors in the journal, and pending updates. Summarize problems by severity.")
        },
        {
            label: _("Why is it slow?"),
            prompt: _("The system feels slow. Investigate CPU, memory, swap, disk usage and the top processes, and explain the most likely cause.")
        },
        {
            label: _("Failed services"),
            prompt: _("List failed systemd units, show the relevant journal errors for each, and suggest fixes without changing anything yet.")
        },
        {
            label: _("Available updates"),
            prompt: _("Check for available package updates and whether a reboot is required. Do not install anything.")
        },
        {
            label: _("Security review"),
            prompt: _("Do a read-only security review: listening ports, firewall status, SELinux/AppArmor, failed SSH logins and recent logins. Highlight anything unusual.")
        },
    ];

    return (
        <Chatbot displayMode={ChatbotDisplayMode.embedded}>
            <ChatbotContent>
                {messages.length === 0
                    ? (
                        <EmptyState>
                            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                                <RobotIcon style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--pf-v6-global--Color--200)' }} />
                                <h4 className="pf-v6-c-title pf-m-lg">{tCockpitCopilot}</h4>
                            </div>
                            <EmptyStateBody>
                                {tGreeting}
                            </EmptyStateBody>
                            <EmptyStateFooter>
                                <EmptyStateActions>
                                    {quickActions.map(action => (
                                        <Button
                                            key={action.label}
                                            variant="secondary"
                                            isDisabled={isProcessing}
                                            onClick={() => handleSendMessage(action.prompt)}
                                        >
                                            {action.label}
                                        </Button>
                                    ))}
                                </EmptyStateActions>
                            </EmptyStateFooter>
                        </EmptyState>
                    )
                    : (
                        <MessageBox>
                            {messages.map((msg, index) => {
                                const messageElements = [];

                                if (msg.role === 'tool') {
                                    const toolName = agent.getToolDisplayName(msg.toolResult?.name || "");
                                    messageElements.push(
                                        <ToolResponse
                                        key={msg.id}
                                        toggleContent={<>{tToolCalling}: <strong>{toolName}</strong></>}
                                        body={(
                                            <div>
                                                {msg.toolResult?.toolCallId && messages.find(m => m.toolCalls?.some(tc => tc.id === msg.toolResult?.toolCallId))?.toolCalls?.find(tc => tc.id === msg.toolResult?.toolCallId) && (
                                                    <div style={{ marginBottom: '1rem' }}>
                                                        <ToolArguments args={parseToolArguments(messages.find(m => m.toolCalls?.some(tc => tc.id === msg.toolResult?.toolCallId))?.toolCalls?.find(tc => tc.id === msg.toolResult?.toolCallId)?.function.arguments || "{}")} />
                                                    </div>
                                                )}
                                                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                                                    {msg.content || msg.toolResult?.output || ""}
                                                </pre>
                                            </div>
                                        )}
                                        isBodyMarkdown={false}
                                        isDefaultExpanded={false}
                                        />
                                    );
                                } else {
                                    messageElements.push(
                                        <Message
                                        key={msg.id}
                                        role={msg.role === 'user' ? 'user' : 'bot'}
                                        content={msg.content}
                                        name={msg.role === 'user' ? tYou : tCopilot}
                                        />
                                    );

                                    // Render associated tool calls inline
                                    if (msg.role === 'assistant' && msg.toolCalls) {
                                        msg.toolCalls.forEach(tc => {
                                            const approval = agent.pendingApprovals.find(p => p.toolCall.id === tc.id);
                                            const isPending = approval !== undefined;
                                            const isDone = messages.some(m => m.role === 'tool' && m.toolResult?.toolCallId === tc.id);
                                            const args = parseToolArguments(tc.function.arguments);
                                            // The diff already shows the new content.
                                            if (approval?.preview?.kind === "diff")
                                                delete args.content;
                                            const toolName = agent.getToolDisplayName(tc.function.name);

                                            // Only render if pending or processing (not done)
                                            if (!isDone) {
                                                const actions = isPending
                                                    ? [
                                                        <Button key="run" variant="secondary" size="sm" onClick={() => agent.approveToolCall(tc.id)}>
                                                            {tApproveRun}
                                                        </Button>,
                                                        ...(approval.canRemember
                                                            ? [
                                                                <Button key="chat" variant="link" size="sm" onClick={() => agent.approveToolCall(tc.id, "chat")}>
                                                                    {_("Allow for this chat")}
                                                                </Button>
                                                            ]
                                                            : []),
                                                        <Button key="reject" variant="link" size="sm" onClick={() => agent.rejectToolCall(tc.id)}>
                                                            {tReject}
                                                        </Button>
                                                    ]
                                                    : [
                                                        <Button key="running" variant="secondary" size="sm" isDisabled isLoading>
                                                            {_("Running...")}
                                                        </Button>
                                                    ];
                                                messageElements.push(
                                                    <ToolCall
                                                    key={tc.id}
                                                    titleText={isPending ? `${tToolApprovalRequired}: ${toolName}` : toolName}
                                                    actions={actions}
                                                    expandableContent={
                                                        <>
                                                            <ToolArguments args={args} />
                                                            {approval?.preview && <ApprovalPreview preview={approval.preview} />}
                                                        </>
                                                    }
                                                    isDefaultExpanded={isPending}
                                                    />
                                                );
                                            }
                                        });
                                    }

                                    // Show regenerate button for the very last message if it is an assistant message
                                    const isLastMessage = index === messages.length - 1;
                                    if (isLastMessage && msg.role === 'assistant' && !isProcessing && !agent.pendingApprovals.length) {
                                        messageElements.push(
                                            <div key="actions" style={{ marginLeft: '3.5rem', marginTop: '0.5rem' }}>
                                                {msg.notice === "step-limit"
                                                    ? (
                                                        <Button
                                                        variant="secondary"
                                                        icon={<PlayIcon />}
                                                        onClick={() => agent.continueAfterStepLimit()}
                                                        size="sm"
                                                        >
                                                            {_("Continue")}
                                                        </Button>
                                                    )
                                                    : (
                                                        <Button
                                                        variant="link"
                                                        icon={<RedoIcon />}
                                                        onClick={() => agent.regenerateLastResponse()}
                                                        size="sm"
                                                        >
                                                            {_("Regenerate")}
                                                        </Button>
                                                    )}
                                            </div>
                                        );
                                    }
                                }
                                return messageElements;
                            })}

                            {isProcessing && !hasPendingApprovals && (
                                <Message role="bot" isLoading loadingWord={tThinking} />
                            )}
                            <div ref={bottomRef} />
                        </MessageBox>
                    )}
            </ChatbotContent>
            <ChatbotFooter>
                <MessageBar
                    onSendMessage={(msg) => handleSendMessage(String(msg))}
                    placeholder={tPlaceholder}
                    innerRef={messageInputRef}
                    isSendButtonDisabled={isProcessing || hasPendingApprovals}
                    hasAttachButton={false} // Disable attachments for now as logic isn't ported
                />
                {isProcessing && (
                    <Button variant="link" onClick={() => agent.cancel()}>
                        {_("Stop")}
                    </Button>
                )}
            </ChatbotFooter>
        </Chatbot>
    );
};
