// table_chat_coding_agent_copy.js
// Names the chat's coding-agent modes and their waiting, answer and availability copy.
// Bridges the server's per-mode availability with the selector, waiting message and answer footer.
// Exists so code editing is never implied for the API-only site assistant, in any interface language.
import { getTranslationForKey } from '../../lang/translation_handler.js';

/** The runner's job modes, in the order the selector lists them. */
export const CODING_AGENT_MODES = Object.freeze(['code_workspace', 'site_assistant']);

// The site's language keys carry the reviewed translations. This local copy is
// the fallback an installation without the keys still shows, in all four
// interface languages.
const FALLBACK_COPY = Object.freeze({
    coding_agent_mode_code_workspace: Object.freeze({
        fi: 'Koodityötila (Codex)', en: 'Code workspace (Codex)',
        ch: '代码工作区 (Codex)', yue: '程式碼工作區 (Codex)',
    }),
    coding_agent_mode_site_assistant: Object.freeze({
        fi: 'Sivustoavustaja (Codex)', en: 'Site assistant (Codex)',
        ch: '站点助手 (Codex)', yue: '網站助手 (Codex)',
    }),
    coding_agent_code_workspace_started: Object.freeze({
        fi: 'Koodityötila aloitti työn.', en: 'Code workspace started working.',
        ch: '代码工作区已开始工作。', yue: '程式碼工作區開始咗工作。',
    }),
    coding_agent_code_workspace_context: Object.freeze({
        fi: 'Codex lukee keskustelua ja tämän koneen koodia.', en: "Codex is reading the chat and this machine's code.",
        ch: 'Codex 正在阅读对话和本机代码。', yue: 'Codex 睇緊對話同呢部機嘅程式碼。',
    }),
    coding_agent_code_workspace_scope: Object.freeze({
        fi: 'Koodityötila voi muokata tämän koneen koodia, ajaa testejä ja käynnistää kehityspalvelimen uudelleen.',
        en: "Code workspace may edit this machine's code, run tests and restart the development server.",
        ch: '代码工作区可以编辑本机代码、运行测试并重启开发服务器。',
        yue: '程式碼工作區可以改呢部機嘅程式碼、行測試同重新啟動開發伺服器。',
    }),
    coding_agent_code_workspace_working: Object.freeze({
        fi: 'Koodityötila työskentelee edelleen.', en: 'Code workspace is still working.',
        ch: '代码工作区仍在工作。', yue: '程式碼工作區仲做緊。',
    }),
    coding_agent_code_workspace_duration: Object.freeze({
        fi: 'Pitkä koodityö voi kestää enintään 40 minuuttia. Palvelimen uudelleenkäynnistys ei keskeytä sitä.',
        en: 'Long code work may take up to 40 minutes. A server restart does not interrupt it.',
        ch: '较长的代码工作最多可能需要 40 分钟。重启服务器不会中断它。',
        yue: '長嘅程式碼工作最多可能要 40 分鐘。重新啟動伺服器唔會打斷佢。',
    }),
    site_assistant_started: Object.freeze({
        fi: 'Sivustoavustaja aloitti työn.', en: 'Site assistant started working.',
        ch: '站点助手已开始工作。', yue: '網站助手開始咗工作。',
    }),
    site_assistant_context: Object.freeze({
        fi: 'Sivustoavustaja lukee keskustelua ja sivuston kontekstia.', en: 'Site assistant is reading the chat and site context.',
        ch: '站点助手正在阅读对话和站点上下文。', yue: '網站助手睇緊對話同網站內容。',
    }),
    site_assistant_scope: Object.freeze({
        fi: 'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
        en: 'Site assistant may inspect the site and prepare API changes for your approval.',
        ch: '站点助手可以检查站点并准备 API 更改供您批准。',
        yue: '網站助手可以檢查網站同準備 API 更改俾你批准。',
    }),
    site_assistant_working: Object.freeze({
        fi: 'Sivustoavustaja työskentelee edelleen.', en: 'Site assistant is still working.',
        ch: '站点助手仍在工作。', yue: '網站助手仲做緊。',
    }),
    site_assistant_duration: Object.freeze({
        fi: 'Pitkä sivustoavustajan työ voi kestää enintään 40 minuuttia.', en: 'Long site-assistant jobs may take up to 40 minutes.',
        ch: '较长的站点助手工作最多可能需要 40 分钟。', yue: '長嘅網站助手工作最多可能要 40 分鐘。',
    }),
    coding_agent_service_label: Object.freeze({ fi: 'Tekoälypalvelu', en: 'AI service', ch: 'AI 服务', yue: 'AI 服務' }),
    coding_agent_service_api: Object.freeze({ fi: 'API-tekoäly', en: 'API AI', ch: 'API AI', yue: 'API AI' }),
    coding_agent_checking: Object.freeze({
        fi: 'Tarkistetaan saatavuutta…', en: 'Checking availability…', ch: '正在检查可用性…', yue: '檢查緊可唔可以用…',
    }),
    coding_agent_not_ready: Object.freeze({
        fi: 'Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.',
        en: 'Coding agent is not ready. An administrator must finish its setup.',
        ch: '编码代理尚未就绪。管理员必须完成设置。', yue: '編碼代理未準備好。管理員要完成設定。',
    }),
    coding_agent_not_running: Object.freeze({
        fi: 'Koodausagentin ajuri ei ole käynnissä. Käynnistä se kehityskoneella komennolla ./ctl agent start.',
        en: 'The coding agent runner is not running. On the development machine, start it with ./ctl agent start.',
        ch: '编码代理运行器未运行。请在开发机器上用 ./ctl agent start 启动它。',
        yue: '編碼代理執行器冇行緊。喺開發機用 ./ctl agent start 啟動佢。',
    }),
    coding_agent_sign_in_required: Object.freeze({
        fi: 'Codex ei ole kirjautunut tällä koneella. Kirjaudu komennolla codex login ja tarkista ./ctl agent check.',
        en: 'Codex is not signed in on this machine. Sign in with codex login, then run ./ctl agent check.',
        ch: 'Codex 尚未在本机登录。请用 codex login 登录，然后运行 ./ctl agent check。',
        yue: 'Codex 未喺呢部機登入。用 codex login 登入，再行 ./ctl agent check。',
    }),
    coding_agent_dev_only: Object.freeze({
        fi: 'Koodausagentti on rajattu kehitysympäristöön.', en: 'Coding agent is restricted to development.',
        ch: '编码代理仅限开发环境使用。', yue: '編碼代理只限開發環境用。',
    }),
    coding_agent_job_pending: Object.freeze({
        fi: 'Työ on yhä käynnissä. Keskustelun avaaminen jatkaa sen tilan seurantaa.',
        en: 'A job is still running. Reopening this chat resumes its status.',
        ch: '任务仍在运行。重新打开此对话将继续显示其状态。', yue: '工作仲行緊。再打開呢個對話會繼續顯示佢嘅狀態。',
    }),
    coding_agent_job_failed: Object.freeze({
        fi: 'Työ keskeytyi tai epäonnistui. Sen loki säilyy ylläpitäjälle.',
        en: 'The job stopped or failed. Its log remains available to the administrator.',
        ch: '任务已停止或失败。其日志仍可供管理员查看。', yue: '工作停咗或者失敗咗。佢嘅記錄仍然俾管理員睇到。',
    }),
    coding_agent_answered_by: Object.freeze({ fi: 'Vastasi', en: 'Answered by', ch: '回答者', yue: '回答者' }),
});

const MODE_COPY_KEYS = Object.freeze({
    code_workspace: Object.freeze({
        label: 'coding_agent_mode_code_workspace',
        pending: Object.freeze([
            'coding_agent_code_workspace_started', 'coding_agent_code_workspace_context',
            'coding_agent_code_workspace_scope', 'coding_agent_code_workspace_working',
            'coding_agent_code_workspace_duration',
        ]),
    }),
    site_assistant: Object.freeze({
        label: 'coding_agent_mode_site_assistant',
        pending: Object.freeze([
            'site_assistant_started', 'site_assistant_context', 'site_assistant_scope',
            'site_assistant_working', 'site_assistant_duration',
        ]),
    }),
});

const GENERAL_COPY_KEYS = Object.freeze({
    failed: 'coding_agent_job_failed',
    label: 'coding_agent_service_label',
    api: 'coding_agent_service_api',
    waiting: 'coding_agent_checking',
    unavailable: 'coding_agent_not_ready',
    notRunning: 'coding_agent_not_running',
    signInRequired: 'coding_agent_sign_in_required',
    dev: 'coding_agent_dev_only',
    pending: 'coding_agent_job_pending',
    answeredBy: 'coding_agent_answered_by',
});

function interfaceLanguage() {
    const language = String(document.documentElement.lang || 'en').trim().toLowerCase();
    if (language.startsWith('fi')) return 'fi';
    if (language.startsWith('yue')) return 'yue';
    if (language === 'ch' || language.startsWith('zh')) return 'ch';
    return 'en';
}

function translated(key) {
    const fallback = FALLBACK_COPY[key]?.[interfaceLanguage()] || FALLBACK_COPY[key]?.en || key;
    return getTranslationForKey(key, { fallback }) || fallback;
}

/** Return whether the server named one of the runner's job modes. */
export function isCodingAgentMode(mode) {
    return CODING_AGENT_MODES.includes(mode);
}

/** The control's general copy in the current interface language. */
export function getCodingAgentCopy() {
    const text = {};
    for (const [name, key] of Object.entries(GENERAL_COPY_KEYS)) {
        text[name] = translated(key);
    }
    return text;
}

/** One mode's selector label and waiting messages, or null for an unknown mode. */
export function getCodingAgentModeCopy(mode) {
    const keys = MODE_COPY_KEYS[mode];
    if (!keys) return null;
    return {
        label: translated(keys.label),
        pendingStatusMessages: keys.pending.map(translated),
    };
}

/** The footer line that tells which mode wrote an answer. */
export function getCodingAgentAnswerFooter(mode) {
    const copy = getCodingAgentModeCopy(mode);
    return copy ? `${translated(GENERAL_COPY_KEYS.answeredBy)}: ${copy.label}` : '';
}

/** Explain why no mode can be used now, from the server's reason code. */
export function getCodingAgentReasonText(reasonCode) {
    const text = getCodingAgentCopy();
    if (reasonCode === 'runner_not_running') return text.notRunning;
    if (reasonCode === 'runner_authentication_required') return text.signInRequired;
    return text.unavailable;
}
