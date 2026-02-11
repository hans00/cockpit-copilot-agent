/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useEffect, useState } from 'react';
import cockpit from "cockpit";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal, ModalVariant, ModalHeader, ModalBody, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { CogIcon } from '@patternfly/react-icons';

import { ChatPanel } from "./components/ChatPanel.jsx";
import { SettingsPage } from "./components/SettingsPage.jsx";
import { Agent } from "./lib/agent.js";
import { McpClientManager } from "./lib/mcp-client.js";
import { loadSettings } from "./lib/settings.js";
import { readCredentials } from "./lib/credentials.js";
import { ChatMessage } from "./lib/types.js";
import { _ } from "./lib/i18n.js";

import "./app.scss";

export const Application = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [agent, setAgent] = useState<Agent | null>(null);
    const [isAgentInit, setIsAgentInit] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    // Initialize Agent on mount
    useEffect(() => {
        initAgent();

        try {
            const permission = cockpit.permission({ admin: true });
            const updateAdmin = () => {
                setIsAdmin(!!permission.allowed);
            };

            permission.addEventListener("changed", updateAdmin);
            updateAdmin();

            return () => {
                permission.removeEventListener("changed", updateAdmin);
                permission.close();
            };
        } catch (e) {
            console.error("Failed to get permission", e);
            setIsAdmin(false);
        }
    }, []);

    const initAgent = async () => {
        const settings = await loadSettings();
        const mcpManager = new McpClientManager();

        const creds = await readCredentials();

        if (creds.apiKey) {
            settings.llm.apiKey = creds.apiKey;
        }

        const newAgent = new Agent(settings, mcpManager, (msgs) => {
            setMessages([...msgs]);
            setIsProcessing(newAgent.isProcessing);
        });

        await newAgent.init();
        setAgent(newAgent);
        setIsAgentInit(true);
    };

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Simple Header */}
            <div style={{
                padding: '0.5rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}
            >
                <Title headingLevel="h1" size="lg">{_("Copilot Agent")}</Title>
                {isAdmin && (
                    <Button variant="plain" onClick={() => setIsSettingsOpen(true)} aria-label={_("Settings")}>
                        <CogIcon />
                    </Button>
                )}
            </div>

            {/* Main Content (Chat) */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                {agent && isAgentInit
                    ? (
                        <ChatPanel
                            agent={agent}
                            messages={messages}
                            isProcessing={isProcessing}
                        />
                    )
                    : (
                        <div style={{ padding: "2rem" }}>{_("Initializing Agent...")}</div>
                    )}
            </div>

            {/* Settings Modal */}
            <Modal
                variant={ModalVariant.medium}
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                aria-describedby="modal-settings-body"
            >
                <ModalHeader title={_("Agent Settings")} />
                <ModalBody id="modal-settings-body">
                    {!isAdmin && (
                        <div className="pf-v6-u-mb-md">
                            <i className="pf-v6-c-content--small" style={{ color: 'var(--pf-v6-global--danger-color--100)' }}>
                                {_("Note: You do not have administrator privileges. Some settings may be read-only or hidden.")}
                            </i>
                        </div>
                    )}
                    <SettingsPage isAdmin={isAdmin} />
                </ModalBody>
            </Modal>
        </div>
    );
};
