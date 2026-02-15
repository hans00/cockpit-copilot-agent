/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useEffect, useState } from 'react';
import { Form, FormGroup, ActionGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";

import { loadSettings, saveSettings } from "../lib/settings.js";
import { readCredentials, writeCredentials } from "../lib/credentials.js";
import { CopilotSettings, DEFAULT_SETTINGS } from "../lib/types.js";
import { McpServerList } from "./McpServerList.jsx";
import { _ } from "../lib/i18n.js";

export const SettingsPage: React.FC<{ isAdmin?: boolean; onSettingsChange?: () => void }> = (props) => {
    const { isAdmin = false } = props;
    const [settings, setSettings] = useState<CopilotSettings>(DEFAULT_SETTINGS);
    const [apiKey, setApiKey] = useState("");
    const [statusMsg, setStatusMsg] = useState<{ type: "success" | "danger", text: string } | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const s = await loadSettings();
        const c = await readCredentials();
        setSettings(s);
        setApiKey(c.apiKey || "");
    };

    const handleSave = async () => {
        if (!isAdmin) {
            setStatusMsg({ type: "danger", text: _("You do not have permission to save settings.") });
            return;
        }
        try {
            await saveSettings(settings);
            await writeCredentials({
                apiKey,
                baseUrl: settings.llm.baseUrl,
                model: settings.llm.model,
                provider: settings.llm.provider
            });
            setStatusMsg({ type: "success", text: _("Settings saved successfully.") });
            if (props.onSettingsChange) {
                props.onSettingsChange();
            }
        } catch (e) {
            setStatusMsg({ type: "danger", text: _("Failed to save settings: ") + e });
        }
    };

    return (
        <div style={{ maxWidth: '800px' }}>
            {statusMsg && (
                <Alert variant={statusMsg.type} title={statusMsg.text} className="pf-v6-u-mb-md" />
            )}

            <Form>
                <Title headingLevel="h2" size="lg">{_("LLM Provider")}</Title>

                <FormGroup label={_("Provider")} fieldId="provider">
                    <FormSelect
                        value={settings.llm.provider}
                        onChange={(_e, val) => {
                            const provider = val as any;
                            let baseUrl = settings.llm.baseUrl;
                            if (provider === "gemini") {
                                baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
                            } else if (provider === "anthropic") {
                                baseUrl = "https://api.anthropic.com/v1";
                            } else if (provider === "openai") {
                                baseUrl = "https://api.openai.com/v1";
                            } else if (provider === "openrouter") {
                                baseUrl = "https://openrouter.ai/api/v1";
                            } else if (provider === "ollama") {
                                baseUrl = "http://localhost:11434/v1";
                            }
                            setSettings({
                                ...settings,
                                llm: { ...settings.llm, provider, baseUrl }
                            });
                        }}
                        id="provider"
                        isDisabled={!isAdmin}
                        aria-label={_("Select LLM Provider")}
                    >
                        <FormSelectOption value="ollama" label={_("Ollama (Local)")} />
                        <FormSelectOption value="openai" label={_("OpenAI")} />
                        <FormSelectOption value="gemini" label={_("Gemini")} />
                        <FormSelectOption value="anthropic" label={_("Anthropic")} />
                        <FormSelectOption value="openrouter" label={_("OpenRouter")} />
                        <FormSelectOption value="custom" label={_("Custom (OpenAI Compatible)")} />
                    </FormSelect>
                </FormGroup>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <FormGroup label={_("Base URL")} fieldId="base-url">
                        <TextInput
                            id="base-url"
                            value={settings.llm.baseUrl}
                            onChange={(_e, val) => setSettings({ ...settings, llm: { ...settings.llm, baseUrl: val } })}
                            isDisabled={!isAdmin}
                        />
                    </FormGroup>

                    <FormGroup label={_("Model Name")} fieldId="model">
                        <TextInput
                            id="model"
                            value={settings.llm.model}
                            onChange={(_e, val) => setSettings({ ...settings, llm: { ...settings.llm, model: val } })}
                            isDisabled={!isAdmin}
                        />
                    </FormGroup>
                </div>

                <FormGroup label={_("API Key")} fieldId="api-key">
                    <TextInput
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(_e, val) => setApiKey(val)}
                        placeholder="sk-..."
                        isDisabled={!isAdmin}
                    />
                </FormGroup>

                <div className="pf-v6-u-my-md" />

                <Title headingLevel="h2" size="lg">{_("System Context")}</Title>
                <FormGroup label={_("Custom System Prompt")} fieldId="sys-prompt">
                    <TextArea
                        id="sys-prompt"
                        value={settings.customSystemPrompt}
                        onChange={(_e, val) => setSettings({ ...settings, customSystemPrompt: val })}
                        rows={4}
                        placeholder={_("Describe this system (e.g. 'Production Web Server') to give the agent context.")}
                        isDisabled={!isAdmin}
                    />
                </FormGroup>

                <div className="pf-v6-u-my-md" />

                <div className="pf-v6-u-my-md" />

                <Title headingLevel="h2" size="lg">{_("Security")}</Title>
                <FormGroup fieldId="shell-access">
                    <Checkbox
                        label={_("Allow Shell Access (Run arbitrary shell commands)")}
                        isChecked={settings.allowShellAccess}
                        onChange={(_e, val) => setSettings({ ...settings, allowShellAccess: val })}
                        id="shell-access"
                        name="shell-access"
                        isDisabled={!isAdmin}
                    />
                    <div className="pf-v6-c-form__helper-text" aria-live="polite">
                        {_("Warning: Enabling this allows the agent to execute any command on the system as you.")}
                    </div>
                </FormGroup>

                <div className="pf-v6-u-my-md" />

                <McpServerList
                    servers={settings.mcpServers}
                    onUpdate={(servers) => setSettings({ ...settings, mcpServers: servers })}
                    readOnly={!isAdmin}
                />

                {isAdmin && (
                    <ActionGroup>
                        <Button variant="primary" onClick={handleSave}>{_("Save Settings")}</Button>
                        <Button variant="link" onClick={loadData}>{_("Reset")}</Button>
                    </ActionGroup>
                )}
            </Form>
        </div>
    );
};
