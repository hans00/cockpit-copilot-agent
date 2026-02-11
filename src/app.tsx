import React, { useEffect, useState } from 'react';
import { Page, PageSidebar, PageSidebarBody, PageSection, Masthead, MastheadMain, MastheadBrand, MastheadContent, Toolbar, ToolbarContent, ToolbarItem, Nav, NavList, NavItem, Button } from "@patternfly/react-core";
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
    const [activeItem, setActiveItem] = useState<string>('chat');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [agent, setAgent] = useState<Agent | null>(null);
    const [isAgentInit, setIsAgentInit] = useState(false);

    // Initialize Agent on mount
    useEffect(() => {
        initAgent();
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
        });

        await newAgent.init();
        setAgent(newAgent);
        setIsAgentInit(true);
    };

    const Header = (
        <Masthead>
            <MastheadMain>
                <MastheadBrand>{_("Cockpit Copilot")}</MastheadBrand>
            </MastheadMain>
            <MastheadContent>
                <Toolbar>
                    <ToolbarContent>
                        <ToolbarItem>
                            <Button variant="plain" onClick={() => setActiveItem('settings')} aria-label={_("Settings")}>
                                <CogIcon />
                            </Button>
                        </ToolbarItem>
                    </ToolbarContent>
                </Toolbar>
            </MastheadContent>
        </Masthead>
    );

    const Navigation = (
        <Nav onSelect={(_e, { itemId }) => setActiveItem(itemId as string)}>
            <NavList>
                <NavItem itemId="chat" isActive={activeItem === 'chat'}>
                    {_("Chat")}
                </NavItem>
                <NavItem itemId="settings" isActive={activeItem === 'settings'}>
                    {_("Settings")}
                </NavItem>
            </NavList>
        </Nav>
    );

    const Sidebar = (
        <PageSidebar isSidebarOpen>
            <PageSidebarBody>
                {Navigation}
            </PageSidebarBody>
        </PageSidebar>
    );

    return (
        <Page masthead={Header} sidebar={Sidebar} style={{ height: '100vh' }}>
            {activeItem === 'chat' && (
                <PageSection variant="default" style={{ height: '100%', padding: 0 }}>
                    {agent && isAgentInit
                        ? (
                            <ChatPanel
                                agent={agent}
                                messages={messages}
                                isProcessing={false}
                            />
                        )
                        : (
                            <div style={{ padding: "2rem" }}>{_("Initializing Agent...")}</div>
                        )}
                </PageSection>
            )}

            {activeItem === 'settings' && (
                <PageSection variant="default">
                    <SettingsPage />
                </PageSection>
            )}
        </Page>
    );
};
