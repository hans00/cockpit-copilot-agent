/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataListAction } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Modal, ModalVariant, ModalHeader, ModalBody, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { McpServerConfig } from "../lib/types.js";
import { PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import { v4 as uuidv4 } from 'uuid';
import { _ } from "../lib/i18n.js";

interface McpServerListProps {
    servers: McpServerConfig[];
    onUpdate: (servers: McpServerConfig[]) => void;
}

export const McpServerList: React.FC<McpServerListProps> = ({ servers, onUpdate }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newServerName, setNewServerName] = useState("");
    const [newServerCommand, setNewServerCommand] = useState("");
    const [newServerArgs, setNewServerArgs] = useState("");

    const handleAdd = () => {
        const args = newServerArgs.split(" ").filter(s => s.trim().length > 0);
        const newServer: McpServerConfig = {
            id: uuidv4(),
            name: newServerName,
            transport: "stdio",
            command: newServerCommand,
            args,
            enabled: true
        };
        onUpdate([...servers, newServer]);
        setIsModalOpen(false);
        setNewServerName("");
        setNewServerCommand("");
        setNewServerArgs("");
    };

    const handleRemove = (id: string) => {
        onUpdate(servers.filter(s => s.id !== id));
    };

    const modalFooter = (
        <div className="pf-v6-c-modal-box__footer">
            <Button key="confirm" variant="primary" onClick={handleAdd}>{_("Add")}</Button>
            <Button key="cancel" variant="link" onClick={() => setIsModalOpen(false)}>{_("Cancel")}</Button>
        </div>
    );

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>{_("Custom MCP Servers")}</h3>
                <Button variant="secondary" icon={<PlusCircleIcon />} onClick={() => setIsModalOpen(true)}>
                    {_("Add Server")}
                </Button>
            </div>

            <DataList aria-label={_("MCP Servers")}>
                {servers.map(server => (
                    <DataListItem key={server.id}>
                        <DataListItemRow>
                            <DataListItemCells
                                dataListCells={[
                                    <DataListCell key="name">
                                        <b>{server.name}</b>
                                    </DataListCell>,
                                    <DataListCell key="command">
                                        <code>{server.command} {(server.args || []).join(" ")}</code>
                                    </DataListCell>
                                ]}
                            />
                            <DataListAction aria-labelledby="remove-server" id="remove-server" aria-label={_("Remove")}>
                                <Button variant="link" icon={<TrashIcon />} onClick={() => handleRemove(server.id)} />
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
                variant={ModalVariant.small}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
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
                    </Form>
                </ModalBody>
                <ModalFooter>
                    {modalFooter}
                </ModalFooter>
            </Modal>
        </>
    );
};
