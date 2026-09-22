// table_chat_coding_agent_control.js
// Shows the chat's AI service selector: API AI plus one option per permitted coding-agent mode.
// Bridges the server's per-mode availability, the stored preference and localized copy.
// Keeps a stopped or unready runner visible and explained instead of silently falling back.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
 CODING_AGENT_MODES,
 getCodingAgentAnswerFooter,
 getCodingAgentCopy,
 getCodingAgentModeCopy,
 getCodingAgentReasonText,
} from "./table_chat_coding_agent_copy.js";

function storedPreference(dataset) {
 try { return localStorage.getItem("gptChatMode_" + dataset) || "api_tools"; } catch { return "api_tools"; }
}

/** Server availability is advisory; the same admin/policy/mode checks run per request. */
export function createCodingAgentControl(dataset) {
 const row = document.createElement("div"); row.className = "chat_coding_agent_control";
 const modeRow = document.createElement("div"); modeRow.className = "chat_mode_row";
 const label = document.createElement("label"); label.htmlFor = dataset + "_chat_mode";
 const select = document.createElement("select"); select.id = label.htmlFor; select.className = "chat_mode_select";
 const api = document.createElement("option"); api.value = "api_tools";
 select.append(api);
 const status = document.createElement("small"); status.setAttribute("role", "status");
 modeRow.append(label, select);
 row.append(modeRow, status);
 let destroyed = false;
 const control = {
  row, select, capability: undefined,
  destroy() { destroyed = true; observer.disconnect(); },
 };
 const preferred = storedPreference(dataset);
 select.value = "api_tools";
 function modeOptions() {
  const offered = Array.isArray(control.capability?.modes) ? control.capability.modes : [];
  return CODING_AGENT_MODES.map(mode => offered.find(entry => entry?.mode === mode)).filter(Boolean);
 }
 function render() {
  if (destroyed) return;
  const text = getCodingAgentCopy(), capability = control.capability;
  label.textContent = text.label; api.textContent = text.api;
  const current = select.value;
  // One option per mode this site permits and the runner offers, in a fixed order.
  const entries = modeOptions();
  for (const option of [...select.options]) {
   if (option.value !== "api_tools" && !entries.some(entry => entry.mode === option.value)) option.remove();
  }
  for (const entry of entries) {
   let option = select.querySelector(`option[value="${entry.mode}"]`);
   if (!option) { option = document.createElement("option"); option.value = entry.mode; select.append(option); }
   option.textContent = getCodingAgentModeCopy(entry.mode).label;
   option.disabled = entry.ready !== true;
  }
  // The administrator-protected GET is authoritative even when the older
  // synchronous route cache has not loaded or lacks this route.
  const permitted = capability?.feature_enabled === true;
  row.hidden = !permitted || entries.length === 0;
  const anyReady = entries.some(entry => entry.ready === true);
  status.textContent = capability && permitted && entries.length > 0 && !anyReady
   ? getCodingAgentReasonText(capability.reason_code) : "";
  status.hidden = !status.textContent;
  const chosen = entries.find(entry => entry.mode === current);
  select.value = chosen?.ready === true ? current : "api_tools";
 }
 const observer = new MutationObserver(render);
 observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
 select.addEventListener("change", () => {
  try { localStorage.setItem("gptChatMode_" + dataset, select.value); } catch { /* preference only */ }
 });
 render();
 endpoint_router("aiChatCodexQuery", { method: "GET", url_params: `?${new URLSearchParams({ dataset }).toString()}`, suppressErrorToast: true, suppressAuthRedirect: true }).then(capability => {
  if (destroyed) return;
  if (typeof capability?.feature_enabled !== "boolean") throw new Error("Invalid coding agent availability");
  control.capability = capability;
  render();
  const stored = modeOptions().find(entry => entry.mode === preferred);
  if (stored?.ready === true) select.value = preferred;
 }).catch(() => {
  if (!destroyed) { control.capability = { feature_enabled: false, runner_ready: false, modes: [] }; render(); }
 });
 return control;
}

/** Name the mode that wrote an answer, under the answer itself. */
export function renderCodingAgentAnswerFooter(messageElement, mode) {
 messageElement?.querySelector(".chat-mode-footer")?.remove();
 const text = getCodingAgentAnswerFooter(mode);
 if (!messageElement || !text) return;
 const footer = document.createElement("div");
 footer.className = "chat-mode-footer"; footer.dataset.mode = mode; footer.textContent = text;
 messageElement.appendChild(footer);
}
