/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useEffect, useState } from 'react';
import cockpit from "cockpit";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal, ModalVariant, ModalHeader, ModalBody } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { CogIcon, BarsIcon } from '@patternfly/react-icons';

import { ChatPanel, finishStartupTotal, setStartupTotalSpan } from "./components/ChatPanel.jsx";
import { SettingsPage } from "./components/SettingsPage.jsx";
import { Agent } from "./lib/agent.js";
import { McpClientManager } from "./lib/mcp-client.js";
import { loadSettings } from "./lib/settings.js";
import { readCredentials } from "./lib/credentials.js";
import { ensureCockpitReady } from "./lib/cockpit-ready.js";
import { ChatMessage, ChatSessionSummary, CopilotSettings } from "./lib/types.js";
import { ChatHistorySidebar } from "./components/ChatHistorySidebar.jsx";
import { Drawer, DrawerContent, DrawerContentBody, DrawerPanelContent } from "@patternfly/react-core/dist/esm/components/Drawer/index.js";
import { _ } from "./lib/i18n.js";
import { diagnostics } from "./lib/diagnostics.js";

import "./app.scss";

type AdminPermission = {
    allowed: boolean | null;
    addEventListener(event: "changed", listener: () => void): void;
    removeEventListener(event: "changed", listener: () => void): void;
    close(): void;
};

const cockpitWithPermission = cockpit as typeof cockpit & {
    permission(options: { admin: true }): AdminPermission;
};

export const Application = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [agent, setAgent] = useState<Agent | null>(null);
    const [isAgentInit, setIsAgentInit] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const [settingsSnapshot, setSettingsSnapshot] = useState<CopilotSettings | null>(null);
    const [apiKeySnapshot, setApiKeySnapshot] = useState("");

    // History state
    const [history, setHistory] = useState<ChatSessionSummary[]>([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    // Initialize Agent on mount
    useEffect(() => {
        let disposed = false;
        let initializedAgent: Agent | null = null;

        const initialize = async () => {
            setInitError(null);
            setIsRetrying(true);
            try {
                const newAgent = await initAgent();
                if (disposed) {
                    await newAgent.close();
                    return;
                }
                initializedAgent = newAgent;
                setAgent(newAgent);
                setIsAgentInit(true);
                setHistory(newAgent.getHistory());
            } catch (error) {
                console.error("Failed to initialize agent", error);
                if (!disposed)
                    setInitError(String(error));
            } finally {
                if (!disposed)
                    setIsRetrying(false);
            }
        };

        initialize();

        let cleanupPermission = () => {};

        try {
            const permission = cockpitWithPermission.permission({ admin: true });
            const updateAdmin = () => {
                setIsAdmin(!!permission.allowed);
            };

            permission.addEventListener("changed", updateAdmin);
            updateAdmin();
            cleanupPermission = () => {
                permission.removeEventListener("changed", updateAdmin);
                permission.close();
            };
        } catch (e) {
            console.error("Failed to get permission", e);
            setIsAdmin(false);
        }

        return () => {
            disposed = true;
            cleanupPermission();
            initializedAgent?.close().catch(error => console.error("Failed to close agent:", error));
        };
    }, []);

    const initAgent = async (): Promise<Agent> => {
        const totalStage = diagnostics.start("startup.total");
        setStartupTotalSpan(totalStage);
        try {
            const cockpitStage = diagnostics.start("startup.cockpit_ready");
            try {
                await ensureCockpitReady();
                diagnostics.end(cockpitStage, { status: "ok" });
            } catch (error) {
                diagnostics.end(cockpitStage, { status: "error" });
                throw error;
            }

            const settingsStage = diagnostics.start("startup.settings_credentials");
            let settings: CopilotSettings;
            let creds: Awaited<ReturnType<typeof readCredentials>>;
            try {
                [settings, creds] = await Promise.all([
                    loadSettings(),
                    readCredentials()
                ]);
                diagnostics.end(settingsStage, { status: "ok" });
            } catch (error) {
                diagnostics.end(settingsStage, { status: "error" });
                throw error;
            }
            setSettingsSnapshot(settings);
            setApiKeySnapshot(creds.apiKey || "");
            const mcpManager = new McpClientManager();

            if (creds.apiKey) {
                settings.llm.apiKey = creds.apiKey;
            }

            const newAgent = new Agent(settings, mcpManager, (msgs) => {
                setMessages([...msgs]);
                setIsProcessing(newAgent.isProcessing);
                setHistory(newAgent.getHistory());
            });

            const agentStage = diagnostics.start("startup.agent_init");
            try {
                await newAgent.init();
                diagnostics.end(agentStage, { status: "ok" });
            } catch (error) {
                diagnostics.end(agentStage, { status: "error" });
                await newAgent.close().catch(closeError => console.error("Failed to clean up initialization:", closeError));
                throw error;
            }
            diagnostics.record("startup.agent_ready", { status: "ready" });
            return newAgent;
        } catch (error) {
            finishStartupTotal("error");
            throw error;
        }
    };

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Simple Header */}
            <div style={{
                padding: '0.5rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--pf-v6-global--BorderColor--100)'
            }}
            >
                <div>
                    <Button
                        variant="plain"
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        aria-label={isHistoryOpen ? _("Close history") : _("Open history")}
                        style={{ marginRight: '1rem' }}
                    >
                        <BarsIcon />
                    </Button>
                    <Title headingLevel="h1" size="lg" style={{ display: 'inline' }}>{_("Copilot Agent")}</Title>
                </div>
                {isAdmin && (
                    <Button variant="plain" onClick={() => setIsSettingsOpen(true)} aria-label={_("Settings")}>
                        <CogIcon />
                    </Button>
                )}
            </div>

            {/* Main Content (Chat + Drawer) */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <Drawer isExpanded={isHistoryOpen} isInline>
                    <DrawerContent panelContent={
                        <DrawerPanelContent isResizable defaultSize="250px" minSize="150px">
                            {agent && (
                                <ChatHistorySidebar
                                    history={history}
                                    currentChatId={agent.currentChatId}
                                    onSelectChat={async (id) => {
                                        await agent.switchToChat(id);
                                    }}
                                    onCreateChat={async () => {
                                        await agent.createNewChat();
                                    }}
                                    onDeleteChat={async (id, e) => {
                                        e.stopPropagation();
                                        await agent.deleteChat(id);
                                    }}
                                />
                            )}
                        </DrawerPanelContent>
                    }
                    >
                        <DrawerContentBody style={{ display: 'flex', flexDirection: 'column' }}>
                            {initError
                                ? (
                                    <div style={{ padding: "2rem" }}>
                                        <Title headingLevel="h2" size="lg">{_("Agent initialization failed")}</Title>
                                        <p>{initError}</p>
                                        <Button
                                            variant="primary"
                                            onClick={() => window.location.reload()}
                                            isDisabled={isRetrying}
                                        >
                                            {_("Retry")}
                                        </Button>
                                    </div>
                                )
                                : agent && isAgentInit
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
                        </DrawerContentBody>
                    </DrawerContent>
                </Drawer>
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
                    {isSettingsOpen && (
                        <SettingsPage
                            isAdmin={isAdmin}
                            initialSettings={settingsSnapshot || undefined}
                            initialApiKey={apiKeySnapshot}
                            onSettingsChange={async () => {
                                if (agent) {
                                    const [newSettings, creds] = await Promise.all([
                                        loadSettings(),
                                        readCredentials()
                                    ]);
                                    if (creds.apiKey)
                                        newSettings.llm.apiKey = creds.apiKey;
                                    await agent.reconfigure(newSettings);
                                    setSettingsSnapshot(newSettings);
                                    setApiKeySnapshot(creds.apiKey || "");
                                }
                            }}
                        />
                    )}
                </ModalBody>
            </Modal>
        </div>
    );
};
