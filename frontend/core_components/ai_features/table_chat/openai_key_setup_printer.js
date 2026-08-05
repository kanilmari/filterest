// openai_key_setup_printer.js
// Renders and submits the inline administrator prompt for a missing OpenAI API key.
// Bridges the table chat configuration response and the protected admin settings endpoint.
// Exists so a fresh Filterest installation can activate chat without exposing the submitted secret.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';

const OPENAI_API_KEYS_URL = 'https://platform.openai.com/api-keys';
const FILTEREST_SUPPORT_EMAIL = 'support@filterest.fi';

const SETUP_COPY = Object.freeze({
    en: Object.freeze({
        title: 'Connect OpenAI',
        explanation: 'Chat needs an OpenAI API key. Create one on OpenAI Platform, then paste it here.',
        fieldLabel: 'OpenAI API key',
        platformLink: 'Open OpenAI API keys',
        securityNote: 'The key is saved only in this installation’s protected settings.',
        supportLink: 'Email Filterest support',
        save: 'Save key and retry',
        saving: 'Saving…',
        saved: 'Key saved. Retrying chat…',
        required: 'Enter an OpenAI API key.',
        failed: 'The key could not be saved. Try again or contact Filterest support.',
    }),
    fi: Object.freeze({
        title: 'Yhdistä OpenAI',
        explanation: 'Chat tarvitsee OpenAI API -avaimen. Luo avain OpenAI Platformissa ja liitä se tähän.',
        fieldLabel: 'OpenAI API -avain',
        platformLink: 'Avaa OpenAI API keys',
        securityNote: 'Avain tallennetaan vain tämän asennuksen suojattuihin asetuksiin.',
        supportLink: 'Lähetä sähköpostia Filterest-tukeen',
        save: 'Tallenna avain ja yritä uudelleen',
        saving: 'Tallennetaan…',
        saved: 'Avain tallennettu. Chat yrittää uudelleen…',
        required: 'Syötä OpenAI API -avain.',
        failed: 'Avainta ei voitu tallentaa. Yritä uudelleen tai ota yhteyttä Filterest-tukeen.',
    }),
    zh: Object.freeze({
        title: '连接 OpenAI',
        explanation: '聊天需要 OpenAI API 密钥。请在 OpenAI Platform 创建密钥，然后粘贴到这里。',
        fieldLabel: 'OpenAI API 密钥',
        platformLink: '打开 OpenAI API keys',
        securityNote: '密钥仅保存在此安装的受保护设置中。',
        supportLink: '发送邮件给 Filterest 支持',
        save: '保存密钥并重试',
        saving: '正在保存…',
        saved: '密钥已保存，正在重试聊天…',
        required: '请输入 OpenAI API 密钥。',
        failed: '无法保存密钥。请重试或联系 Filterest 支持。',
    }),
    yue: Object.freeze({
        title: '連接 OpenAI',
        explanation: '聊天需要 OpenAI API 金鑰。請喺 OpenAI Platform 建立金鑰，再貼到呢度。',
        fieldLabel: 'OpenAI API 金鑰',
        platformLink: '開啟 OpenAI API keys',
        securityNote: '金鑰只會儲存喺呢個安裝嘅受保護設定。',
        supportLink: '電郵聯絡 Filterest 支援',
        save: '儲存金鑰並重試',
        saving: '儲存中…',
        saved: '金鑰已儲存，正重新嘗試聊天…',
        required: '請輸入 OpenAI API 金鑰。',
        failed: '未能儲存金鑰。請重試或聯絡 Filterest 支援。',
    }),
});

function currentSetupCopy() {
    const language = String(
        document.documentElement.lang || getLanguageWithBrowserFallback() || 'en'
    ).trim().toLowerCase();
    if (language.startsWith('fi')) return SETUP_COPY.fi;
    if (language.startsWith('yue')) return SETUP_COPY.yue;
    if (language === 'ch' || language.startsWith('zh')) return SETUP_COPY.zh;
    return SETUP_COPY.en;
}

export function isOpenAIKeyConfigurationRequired(error) {
    return error?.code === 'openai_api_key_missing';
}

export function renderOpenAIKeySetupPrompt(messageElement, { onSaved } = {}) {
    const textContainer = messageElement?.querySelector?.('.chat-text');
    if (!textContainer) return;

    const copy = currentSetupCopy();
    const form = document.createElement('form');
    form.classList.add('chat-openai-key-setup');

    const title = document.createElement('strong');
    title.classList.add('chat-openai-key-setup__title');
    title.textContent = copy.title;

    const explanation = document.createElement('span');
    explanation.textContent = copy.explanation;

    const platformLink = document.createElement('a');
    platformLink.href = OPENAI_API_KEYS_URL;
    platformLink.target = '_blank';
    platformLink.rel = 'noopener noreferrer';
    platformLink.textContent = copy.platformLink;

    const label = document.createElement('label');
    label.textContent = copy.fieldLabel;

    const input = document.createElement('input');
    input.type = 'password';
    input.name = 'openai_api_key';
    input.autocomplete = 'new-password';
    input.spellcheck = false;
    input.required = true;
    input.maxLength = 4096;
    label.appendChild(input);

    const securityNote = document.createElement('small');
    securityNote.textContent = copy.securityNote;

    const actions = document.createElement('div');
    actions.classList.add('chat-openai-key-setup__actions');

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = copy.save;

    const supportLink = document.createElement('a');
    supportLink.href = `mailto:${FILTEREST_SUPPORT_EMAIL}?subject=Filterest%20OpenAI%20API%20key`;
    supportLink.textContent = copy.supportLink;
    actions.append(saveButton, supportLink);

    const status = document.createElement('span');
    status.classList.add('chat-openai-key-setup__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    form.append(title, explanation, platformLink, label, securityNote, actions, status);
    textContainer.replaceChildren(form);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const apiKey = input.value.trim();
        if (!apiKey) {
            status.textContent = copy.required;
            input.focus();
            return;
        }

        input.disabled = true;
        saveButton.disabled = true;
        saveButton.textContent = copy.saving;
        status.textContent = '';
        try {
            await endpoint_router('saveOpenAIAPIKey', {
                method: 'POST',
                body_data: { api_key: apiKey },
            });
            input.value = '';
            status.textContent = copy.saved;
            await onSaved?.();
        } catch (error) {
            void error;
            status.textContent = copy.failed;
            input.disabled = false;
            saveButton.disabled = false;
            saveButton.textContent = copy.save;
            input.focus();
        }
    });
}
