/* SPDX-License-Identifier: LGPL-2.1-or-later */
import React, { useEffect, useState } from 'react';
import { Form, FormGroup, ActionGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

import { loadSettings, saveSettings } from "../lib/settings.js";
import { readCredentials, writeCredentials } from "../lib/credentials.js";
import { CopilotSettings, DEFAULT_SETTINGS } from "../lib/types.js";
import { McpServerList } from "./McpServerList.jsx";
import { _ } from "../lib/i18n.js";

export const SettingsPage = () => {
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
        try {
            await saveSettings(settings);
            await writeCredentials({
                apiKey,
                baseUrl: settings.llm.baseUrl,
                model: settings.llm.model,
                provider: settings.llm.provider
            });
            setStatusMsg({ type: "success", text: _("Settings saved successfully.") });
        } catch (e) {
            setStatusMsg({ type: "danger", text: _("Failed to save settings: ") + e });
        }
    };

    return (
        <div className="pf-v6-u-p-md" style={{ maxWidth: '800px' }}>
            <Title headingLevel="h1" size="2xl" className="pf-v6-u-mb-lg">{_("Agent Settings")}</Title>

            {statusMsg && (
                <Alert variant={statusMsg.type} title={statusMsg.text} className="pf-v6-u-mb-md" />
            )}

            <Form>
                <Title headingLevel="h2" size="xl">{_("LLM Provider")}</Title>

                <FormGroup label={_("Provider")} fieldId="provider">
                    <select
                        className="pf-v6-c-form-control"
                        value={settings.llm.provider}
                        onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, provider: e.currentTarget.value as any } })} // eslint-disable-line @typescript-eslint/no-explicit-any
                        id="provider"
                    >
                        <option value="ollama">{_("Ollama (Local)")}</option>
                        <option value="openai">{_("OpenAI")}</option>
                        <option value="gemini">{_("Gemini")}</option>
                        <option value="anthropic">{_("Anthropic")}</option>
                        <option value="openrouter">{_("OpenRouter")}</option>
                        <option value="custom">{_("Custom (OpenAI Compatible)")}</option>
                    </select>
                </FormGroup>

                <FormGroup label={_("Base URL")} fieldId="base-url">
                    <TextInput
                        id="base-url"
                        value={settings.llm.baseUrl}
                        onChange={(_e, val) => setSettings({ ...settings, llm: { ...settings.llm, baseUrl: val } })}
                    />
                </FormGroup>

                <FormGroup label={_("Model Name")} fieldId="model">
                    <TextInput
                        id="model"
                        value={settings.llm.model}
                        onChange={(_e, val) => setSettings({ ...settings, llm: { ...settings.llm, model: val } })}
                    />
                </FormGroup>

                <FormGroup label={_("API Key")} fieldId="api-key">
                    <TextInput
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(_e, val) => setApiKey(val)}
                        placeholder="sk-..."
                    />
                </FormGroup>

                <div className="pf-v6-u-my-lg" />

                <Title headingLevel="h2" size="xl">{_("System Context")}</Title>
                <FormGroup label={_("Custom System Prompt")} fieldId="sys-prompt">
                    <TextArea
                        id="sys-prompt"
                        value={settings.customSystemPrompt}
                        onChange={(_e, val) => setSettings({ ...settings, customSystemPrompt: val })}
                        rows={4}
                        placeholder={_("Describe this system (e.g. 'Production Web Server') to give the agent context.")}
                    />
                </FormGroup>

                <div className="pf-v6-u-my-lg" />

                <McpServerList
                    servers={settings.mcpServers}
                    onUpdate={(servers) => setSettings({ ...settings, mcpServers: servers })}
                />

                <ActionGroup>
                    <Button variant="primary" onClick={handleSave}>{_("Save Settings")}</Button>
                    <Button variant="link" onClick={loadData}>{_("Cancel")}</Button>
                </ActionGroup>
            </Form>
        </div>
    );
};
