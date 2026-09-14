// table_chat_coding_agent_control.js
// Shows administrator coding-agent availability without starting a job.
// Bridges server policy/readiness, existing chat preferences and localized copy.
// Keeps production permission distinct from missing runner configuration.
import { endpoint_router } from "../../endpoints/endpoint_router.js";

const copy = {
 en: { failed: "The coding job stopped or failed. Its log remains available to the administrator.", label: "AI service", api: "API AI", agent: "Coding agent (Codex)", waiting: "Checking availability…", unavailable: "Coding agent is not ready. An administrator must finish its setup.", dev: "Coding agent is restricted to development.", pending: "A coding job is still running. Reopening this chat resumes its status." },
 fi: { failed: "Koodaustyö keskeytyi tai epäonnistui. Sen loki säilyy ylläpitäjälle.", label: "Tekoälypalvelu", api: "API-tekoäly", agent: "Koodausagentti (Codex)", waiting: "Tarkistetaan saatavuutta…", unavailable: "Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.", dev: "Koodausagentti on rajattu kehitysympäristöön.", pending: "Koodaustyö on yhä käynnissä. Keskustelun avaaminen jatkaa sen tilan seurantaa." },
 sv: { failed: "Kodningsjobbet avbröts eller misslyckades. Loggen finns kvar för administratören.", label: "AI-tjänst", api: "API-AI", agent: "Kodningsagent (Codex)", waiting: "Kontrollerar tillgänglighet…", unavailable: "Kodningsagenten är inte redo. En administratör måste slutföra installationen.", dev: "Kodningsagenten är begränsad till utvecklingsmiljön.", pending: "Ett kodningsjobb pågår. Öppna chatten igen för att följa statusen." },
 de: { failed: "Der Programmierauftrag wurde beendet oder ist fehlgeschlagen. Das Protokoll bleibt für den Administrator verfügbar.", label: "KI-Dienst", api: "API-KI", agent: "Programmieragent (Codex)", waiting: "Verfügbarkeit wird geprüft…", unavailable: "Der Programmieragent ist noch nicht bereit. Ein Administrator muss die Einrichtung abschließen.", dev: "Der Programmieragent ist auf die Entwicklungsumgebung beschränkt.", pending: "Ein Programmierauftrag läuft. Öffnen Sie den Chat erneut, um den Status zu verfolgen." },
};
export function codingAgentCopy() {
 const language = String(document.documentElement.lang || "en").split("-")[0];
 return copy[language] || copy.en;
}

/** Server availability is advisory; the same admin/policy checks run per request. */
export function createCodingAgentControl(dataset) {
 const row = document.createElement("div"); row.className = "chat_coding_agent_control";
 const modeRow = document.createElement("div"); modeRow.className = "chat_mode_row";
 const label = document.createElement("label"); label.htmlFor = dataset + "_chat_mode";
 const select = document.createElement("select"); select.id = label.htmlFor; select.className = "chat_mode_select";
 const api = document.createElement("option"); api.value = "api_tools";
 const agent = document.createElement("option"); agent.value = "codex_dev";
 select.append(api, agent);
 const status = document.createElement("small"); status.setAttribute("role", "status");
 modeRow.append(label, select);
 row.append(modeRow, status);
 let destroyed = false;
 const control = { row, select, capability: undefined, destroy() { destroyed = true; observer.disconnect(); } };
 const preferred = localStorage.getItem("gptChatMode_" + dataset) || "api_tools";
 select.value = "api_tools";
 function render() {
  if (destroyed) return;
  const text = codingAgentCopy(), capability = control.capability;
  label.textContent = text.label; api.textContent = text.api; agent.textContent = text.agent;
  // The administrator-protected GET is authoritative even when the older
  // synchronous route cache has not loaded or lacks this newly shipped route.
  const permitted = capability?.feature_enabled === true;
  row.hidden = !permitted;
  agent.disabled = !(permitted && capability?.runner_ready === true);
  status.textContent = capability ? (permitted && !capability.runner_ready ? text.unavailable : "") : "";
  status.hidden = !status.textContent;
  if (!permitted || agent.disabled) select.value = "api_tools";
 }
 const observer = new MutationObserver(render);
 observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
 select.addEventListener("change", () => localStorage.setItem("gptChatMode_" + dataset, select.value));
 render();
 endpoint_router("aiChatCodexQuery", { method: "GET", url_params: new URLSearchParams({ dataset }).toString(), suppressErrorToast: true, suppressAuthRedirect: true }).then(capability => {
  if (destroyed) return;
  if (typeof capability?.feature_enabled !== "boolean") throw new Error("Invalid coding agent availability");
  control.capability = capability;
  if (capability.feature_enabled && capability.runner_ready && preferred === "codex_dev") select.value = "codex_dev";
  render();
 }).catch(() => {
  if (!destroyed) { control.capability = { feature_enabled: false, runner_ready: false }; render(); }
 });
 return control;
}
