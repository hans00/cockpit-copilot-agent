/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataListAction } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Modal, ModalVariant, ModalHeader, ModalBody, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { McpServerConfig } from "../lib/types.js";
import { PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import { v4 as uuidv4 } from 'uuid';
import { _ } from "../lib/i18n.js";

const normalizeUrl = (url: string | URL): string => {
    try {
        const u = new URL(url);
        return u.origin + '/';
    } catch {
        return String(url);
    }
}

// Hide args too long
const normalizeCommand = (command: string): string => {
    return command.replace(/\s+/g, " ").substring(0, 20) + (command.length > 20 ? "..." : "");
}

interface McpServerListProps {
    servers: McpServerConfig[];
    onUpdate: (servers: McpServerConfig[]) => void;
    readOnly?: boolean;
}

export const McpServerList: React.FC<McpServerListProps> = ({ servers, onUpdate, readOnly = false }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newServerName, setNewServerName] = useState("");
    const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("stdio");
    const [newServerCommand, setNewServerCommand] = useState("");
    const [newServerArgs, setNewServerArgs] = useState("");
    const [newServerUrl, setNewServerUrl] = useState("");

    const handleAdd = () => {
        if (readOnly) return;
        
        let newServer: McpServerConfig;

        if (newServerTransport === "stdio") {
             const args = newServerArgs.split(" ").filter(s => s.trim().length > 0);
             newServer = {
                id: uuidv4(),
                name: newServerName,
                transport: "stdio",
                command: newServerCommand,
                args,
                enabled: true
            };
        } else {
            newServer = {
                id: uuidv4(),
                name: newServerName,
                transport: "http",
                url: newServerUrl,
                enabled: true
            };
        }
       
        onUpdate([...servers, newServer]);
        setIsModalOpen(false);
        resetForm();
    };

    const resetForm = () => {
        setNewServerName("");
        setNewServerTransport("stdio");
        setNewServerCommand("");
        setNewServerArgs("");
        setNewServerUrl("");
    };

    const handleRemove = (id: string) => {
        if (readOnly) return;
        onUpdate(servers.filter(s => s.id !== id));
    };

    const handleToggle = (id: string, enabled: boolean) => {
        if (readOnly) return;
        onUpdate(servers.map(s => s.id === id ? { ...s, enabled } : s));
    };

    const modalFooter = (
        <div className="pf-v6-c-modal-box__footer">
            <Button key="confirm" variant="primary" onClick={handleAdd}>{_("Add")}</Button>
            <Button key="cancel" variant="link" onClick={() => { setIsModalOpen(false); resetForm(); }}>{_("Cancel")}</Button>
        </div>
    );

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <Title headingLevel="h3" size="lg">{_("Custom MCP Servers")}</Title>
                {!readOnly && (
                    <Button variant="secondary" icon={<PlusCircleIcon />} onClick={() => setIsModalOpen(true)}>
                        {_("Add Server")}
                    </Button>
                )}
            </div>

            <DataList aria-label={_("MCP Servers")}>
                {servers.map(server => (
                    <DataListItem key={server.id}>
                        <DataListItemRow style={{ alignItems: 'center' }}>
                            <DataListItemCells
                                dataListCells={[
                                    <DataListCell key="name">
                                        <b>{server.name}</b>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--pf-v6-global--Color--200)' }}>
                                            {server.transport === "http" ? "Streamable HTTP" : "Stdio"}
                                        </div>
                                    </DataListCell>,
                                    <DataListCell key="details">
                                        {server.transport === "http" ? (
                                            <code title={normalizeUrl(server.url!)}>
                                                {normalizeUrl(server.url!)}
                                            </code>
                                        ) : (
                                            <code>{normalizeCommand(`${server.command} ${(server.args || []).join(" ")}`)}</code>
                                        )}
                                    </DataListCell>
                                ]}
                            />
                            <DataListAction
                                aria-labelledby="server-actions"
                                id="server-actions"
                                aria-label={_("Server Actions")}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <Switch
                                        id={`server-switch-${server.id}`}
                                        aria-label={_("Enable Server")}
                                        isChecked={server.enabled !== false}
                                        onChange={(_e, val) => handleToggle(server.id, val)}
                                        isDisabled={readOnly}
                                    />
                                    {!readOnly && (
                                        <Button variant="link" icon={<TrashIcon />} onClick={() => handleRemove(server.id)} aria-label={_("Remove")} />
                                    )}
                                </div>
                            </DataListAction>
                        </DataListItemRow>
                    </DataListItem>
                ))}
                {servers.length === 0 && (
                    <DataListItem aria-labelledby="empty-item">
                        <DataListItemRow>
                            <DataListItemCells
                                dataListCells={[
                                    <DataListCell key="empty">
                                        <i>{_("No custom servers configured. The built-in system server is always active.")}</i>
                                    </DataListCell>
                                ]}
                            />
                        </DataListItemRow>
                    </DataListItem>
                )}
            </DataList>

            <Modal
                variant={ModalVariant.medium}
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); resetForm(); }}
            >
                <ModalHeader title={_("Add Custom MCP Server")} />
                <ModalBody>
                    <Form>
                        <FormGroup label={_("Name")} fieldId="server-name" isRequired>
                            <TextInput
                                isRequired
                                type="text"
                                id="server-name"
                                value={newServerName}
                                onChange={(_e, val) => setNewServerName(val)}
                            />
                        </FormGroup>
                        
                        <FormGroup label={_("Transport Type")} fieldId="server-transport" isRequired>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input 
                                        type="radio" 
                                        name="transport" 
                                        value="stdio" 
                                        checked={newServerTransport === "stdio"} 
                                        onChange={() => setNewServerTransport("stdio")} 
                                    />
                                    {_("Stdio")}
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input 
                                        type="radio" 
                                        name="transport" 
                                        value="http" 
                                        checked={newServerTransport === "http"} 
                                        onChange={() => setNewServerTransport("http")} 
                                    />
                                    {_("Streamable HTTP")}
                                </label>
                            </div>
                        </FormGroup>

                        {newServerTransport === "stdio" ? (
                            <>
                                <FormGroup label={_("Command")} fieldId="server-command" isRequired>
                                    <TextInput
                                        isRequired
                                        type="text"
                                        id="server-command"
                                        value={newServerCommand}
                                        onChange={(_e, val) => setNewServerCommand(val)}
                                        placeholder="e.g. python3"
                                    />
                                </FormGroup>
                                <FormGroup label={_("Arguments")} fieldId="server-args">
                                    <TextInput
                                        type="text"
                                        id="server-args"
                                        value={newServerArgs}
                                        onChange={(_e, val) => setNewServerArgs(val)}
                                        placeholder="e.g. /path/to/server.py --flag"
                                    />
                                </FormGroup>
                            </>
                        ) : (
                            <FormGroup label={_("Server URL")} fieldId="server-url" isRequired>
                                <TextInput
                                    isRequired
                                    type="url"
                                    id="server-url"
                                    value={newServerUrl}
                                    onChange={(_e, val) => setNewServerUrl(val)}
                                    placeholder="e.g. http://localhost:3000/mcp"
                                />
                            </FormGroup>
                        )}
                    </Form>
                </ModalBody>
                <ModalFooter>
                    {modalFooter}
                </ModalFooter>
            </Modal>
        </>
    );
};
