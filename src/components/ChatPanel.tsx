/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle, CardFooter } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { RobotIcon, UserIcon, WrenchIcon, CheckCircleIcon, TimesCircleIcon, PaperPlaneIcon } from '@patternfly/react-icons';
import { marked } from 'marked';
import { ChatMessage, ToolCall } from "../lib/types.js";
import type { Agent } from "../lib/agent.js";
import { _ } from "../lib/i18n.js";

// Helper to render markdown safely
const Markdown = ({ content }: { content: string }) => {
    // Safe check if content is undefined/null
    const html = marked.parse(content || "");
    return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html as string }} />;
};

interface ChatPanelProps {
    agent: Agent;
    messages: ChatMessage[];
    isProcessing: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ agent, messages, isProcessing }) => {
    const [input, setInput] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Scroll to bottom
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSubmit = async () => {
        if (!input.trim()) return;
        const text = input;
        setInput("");
        // isProcessing is handled by parent or agent state
        await agent.addUserMessage(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Prevent submission if user is actively composing text via IME (e.g. Japanese/Chinese)
        if (e.nativeEvent.isComposing) {
            return;
        }

        // Only submit on Enter without Shift.
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    // Determine waiting state from agent
    const waitingForApproval = agent.waitingForApproval;

    const renderMessage = (msg: ChatMessage) => {
        const isUser = msg.role === "user";
        const isTool = msg.role === "tool";

        if (isTool) {
            return (
                <div key={msg.id} className="pf-v6-u-mb-md" style={{ marginLeft: '2rem', borderLeft: '3px solid #eee', paddingLeft: '1rem' }}>
                    <Label color="blue" icon={<WrenchIcon />}>{_("Tool Output")}</Label>
                    <pre style={{ fontSize: '0.8rem', background: '#f5f5f5', padding: '0.5rem', marginTop: '0.5rem', overflowX: 'auto' }}>
                        {msg.content || (msg.toolResult ? msg.toolResult.output : "")}
                    </pre>
                </div>
            );
        }

        return (
            <div
                key={msg.id} className="pf-v6-u-mb-lg"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start'
                }}
            >

                <div style={{
                    background: isUser ? '#f0f0f0' : '#fff',
                    border: isUser ? 'none' : '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '1rem',
                    maxWidth: '85%'
                }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', opacity: 0.7 }}>
                        {isUser ? <UserIcon style={{ marginRight: '0.5rem' }} /> : <RobotIcon style={{ marginRight: '0.5rem' }} />}
                        <strong>{isUser ? _("You") : _("Copilot")}</strong>
                    </div>
                    <Markdown content={msg.content} />
                </div>
            </div>
        );
    };

    const content = messages.length === 0
        ? (
            <EmptyState>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    <RobotIcon style={{ fontSize: '3rem', marginBottom: '1rem', color: '#6a6e73' }} />
                    <h4 className="pf-v6-c-title pf-m-lg">{_("Cockpit Copilot")}</h4>
                </div>
                <EmptyStateBody>
                    {_("Hi! I'm your system agent using MCP. Ask me to manage services, install packages, or check system logs.")}
                </EmptyStateBody>
            </EmptyState>
        )
        : (
            messages.map((msg) => renderMessage(msg))
        );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            {/* Messages Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', paddingBottom: '100px' }}>
                {content}

                {waitingForApproval && waitingForApproval.toolCall && (
                    <div className="pf-v6-u-mb-lg pf-v6-u-p-md" style={{ margin: '1rem auto', maxWidth: '600px' }}>
                        <ToolApprovalCard
                            toolCall={waitingForApproval.toolCall}
                            onApprove={() => agent.approveToolCall(waitingForApproval.toolCall.id)}
                            onReject={() => agent.rejectToolCall(waitingForApproval.toolCall.id)}
                        />
                    </div>
                )}

                {isProcessing && !waitingForApproval && (
                    <div style={{ padding: '1rem', opacity: 0.6, fontStyle: 'italic' }}>
                        <Spinner size="md" /> {_("Thinking...")}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <div style={{ padding: '1rem', borderTop: '1px solid #eee', background: '#fff' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <TextArea
                        value={input}
                        onChange={(_e, val) => setInput(val)}
                        onKeyDown={handleKeyDown}
                        placeholder={_("Type a command or ask a question...")}
                        autoResize
                        style={{ minHeight: '50px', maxHeight: '150px', width: '100%' }}
                    />
                    <Button variant="primary" onClick={handleSubmit} isDisabled={isProcessing || waitingForApproval !== null || !input.trim()} aria-label={_("Send")}>
                        <PaperPlaneIcon />
                    </Button>
                </div>
            </div>
        </div>
    );
};

interface ToolApprovalCardProps {
    toolCall: ToolCall;
    onApprove: () => void;
    onReject: () => void;
}

const ToolApprovalCard: React.FC<ToolApprovalCardProps> = ({ toolCall, onApprove, onReject }) => {
    return (
        <Card isCompact className="tool-approval-card" style={{ border: '2px solid #0066cc' }}>
            <CardTitle><WrenchIcon /> {_("Tool Approval Required")}</CardTitle>
            <CardBody>
                <p>{_("The agent wants to execute:")} <strong>{toolCall.function.name}</strong></p>
                <div style={{ background: '#f5f5f5', padding: '0.5rem', border: '1px solid #ccc', marginTop: '0.5rem', maxHeight: '200px', overflow: 'auto' }}>
                    <pre>{JSON.stringify(JSON.parse(toolCall.function.arguments), null, 2)}</pre>
                </div>
            </CardBody>
            <CardFooter>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <Button variant="primary" icon={<CheckCircleIcon />} onClick={onApprove}>{_("Approve & Run")}</Button>
                    <Button variant="danger" icon={<TimesCircleIcon />} onClick={onReject}>{_("Reject")}</Button>
                </div>
            </CardFooter>
        </Card>
    );
};
