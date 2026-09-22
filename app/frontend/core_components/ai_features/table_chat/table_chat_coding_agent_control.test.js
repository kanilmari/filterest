// @vitest-environment jsdom
// table_chat_coding_agent_control.test.js
// Verifies the AI service selector offers one option per permitted mode without starting jobs.
// Bridges translated UI, asynchronous availability, stored preferences and runner states.
// Keeps a stopped or unready runner explained instead of silently falling back.
import { beforeEach, expect, test, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
const permission = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: request }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: permission }));
vi.mock("../../../ui_config.js", () => ({ FILTERBAR_AI_CHAT_MODE: "api_tools" }));
// The control reads its copy from the site's language keys; the fixture answers
// Finnish for chosen keys and lets the rest fall back to the local copy.
const translations = vi.hoisted(() => new Map());
vi.mock("../../lang/translation_handler.js", () => ({
 getTranslationForKey: (key, { fallback } = {}) => translations.get(key) ?? fallback,
}));
import { createCodingAgentControl, renderCodingAgentAnswerFooter } from "./table_chat_coding_agent_control.js";
const both = (codeReady, siteReady) => [{ mode: "code_workspace", ready: codeReady }, { mode: "site_assistant", ready: siteReady }];
const option = (control, mode) => control.select.querySelector(`[value="${mode}"]`);
beforeEach(() => {
 document.head.innerHTML='<meta name="app-env" content="prod">';
 document.documentElement.lang="fi";delete document.documentElement.dataset.theme;
 document.body.innerHTML="";localStorage.clear();
 request.mockReset();permission.mockReturnValue(true);
 translations.clear();
});
test("a denied administrator request leaves controls hidden even with stale route access", async () => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 request.mockRejectedValue(Object.assign(new Error("Forbidden"),{status:403}));
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.capability?.feature_enabled).toBe(false));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 expect(control.select.options).toHaveLength(1);
 expect(request).toHaveBeenCalledWith("aiChatCodexQuery",expect.objectContaining({suppressAuthRedirect:true}));
 control.destroy();
});
test("enabled production with an unready runner explains setup without allowing sends", async () => {
 translations.set("coding_agent_not_ready","Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.");
 request.mockResolvedValue({feature_enabled:true,runner_ready:false,dev_only:false,reason_code:"runner_version_mismatch",modes:[{mode:"site_assistant",ready:false}]});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.row.hidden).toBe(false));
 await vi.waitFor(()=>expect(control.row.textContent).toContain("ei ole valmis"));
 expect(option(control,"site_assistant").disabled).toBe(true);
 expect(option(control,"code_workspace")).toBeNull();
 expect(request).toHaveBeenCalledWith("aiChatCodexQuery",expect.objectContaining({method:"GET",url_params:"?dataset=fixture"}));
 expect(request.mock.calls.every(([, options])=>options.method==="GET")).toBe(true);
 control.destroy();
});
test.each(["light","dark"])("ready site-assistant selection is explicit in the %s theme and survives FI to EN", async theme => {
 document.documentElement.dataset.theme=theme;
 translations.set("coding_agent_mode_site_assistant","Sivustoavustaja (sivuston käännös)");
 request.mockResolvedValue({feature_enabled:true,runner_ready:true,modes:[{mode:"site_assistant",ready:true}]});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(option(control,"site_assistant")?.disabled).toBe(false));
 expect(control.row.textContent).toContain("Sivustoavustaja (sivuston käännös)");
 control.select.value="site_assistant";control.select.dispatchEvent(new Event("change"));control.select.focus();
 translations.delete("coding_agent_mode_site_assistant");
 document.documentElement.lang="en";
 await vi.waitFor(()=>expect(control.row.textContent).toContain("Site assistant (Codex)"));
 expect(control.row.textContent).toContain("AI service");
 expect(control.select.value).toBe("site_assistant");expect(document.activeElement).toBe(control.select);
 expect(localStorage.getItem("gptChatMode_fixture")).toBe("site_assistant");
 control.destroy();
});
test("development offers both modes in a fixed order and restores a stored ready choice", async () => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 localStorage.setItem("gptChatMode_fixture","code_workspace");
 request.mockResolvedValue({feature_enabled:true,runner_ready:true,modes:[...both(true,true)].reverse()});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.select.value).toBe("code_workspace"));
 expect([...control.select.options].map(item=>item.value)).toEqual(["api_tools","code_workspace","site_assistant"]);
 expect(option(control,"code_workspace").textContent).toBe("Koodityötila (Codex)");
 document.documentElement.lang="en";
 await vi.waitFor(()=>expect(option(control,"code_workspace").textContent).toBe("Code workspace (Codex)"));
 control.destroy();
});
test("a stopped runner keeps the modes visible, disabled and explained", async () => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 document.documentElement.lang="en";
 localStorage.setItem("gptChatMode_fixture","code_workspace");
 request.mockResolvedValue({feature_enabled:true,runner_ready:false,reason_code:"runner_not_running",modes:both(false,false)});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.row.textContent).toContain("./ctl agent start"));
 expect(option(control,"code_workspace").disabled).toBe(true);
 expect(option(control,"site_assistant").disabled).toBe(true);
 expect(control.select.value).toBe("api_tools");
 control.destroy();
});
test("a late availability response cannot revive destroyed controls", async () => {
 let resolve;request.mockReturnValue(new Promise(done=>{resolve=done;}));
 const control=createCodingAgentControl("fixture");control.destroy();
 resolve({feature_enabled:true,runner_ready:true,modes:both(true,true)});
 await Promise.resolve();expect(control.capability).toBeUndefined();expect(control.row.hidden).toBe(true);
});
test("fresh administrator availability recovers missing route cache without early visibility", async () => {
 permission.mockReturnValue(false);
 let resolve;request.mockReturnValue(new Promise(done=>{resolve=done;}));
 const control=createCodingAgentControl("fixture");
 document.body.append(control.row);
 expect(control.row.hidden).toBe(true);
 expect(control.select.options).toHaveLength(1);
 resolve({feature_enabled:true,runner_ready:false,dev_only:false,modes:[{mode:"site_assistant",ready:false}]});
 await vi.waitFor(()=>expect(control.row.hidden).toBe(false));
 expect(control.row.textContent).toContain("ei ole valmis");
 expect(control.select.value).toBe("api_tools");
 expect(request.mock.calls).toHaveLength(1);
 control.destroy();
});
test.each([401,403,503])("failed availability %s cannot enable a stored choice", async status => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 localStorage.setItem("gptChatMode_fixture","code_workspace");
 request.mockRejectedValue(Object.assign(new Error("Unavailable"),{status}));
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.capability?.feature_enabled).toBe(false));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 control.destroy();
});
test("production policy restriction hides the service even with a ready runner", async () => {
 request.mockResolvedValue({feature_enabled:false,runner_ready:false,dev_only:true,modes:[]});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.capability?.dev_only).toBe(true));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 control.destroy();
});
test("an answer names the mode that wrote it, and nothing for API AI", () => {
 document.documentElement.lang="en";
 const bubble=document.createElement("div");
 renderCodingAgentAnswerFooter(bubble,"code_workspace");
 expect(bubble.querySelector(".chat-mode-footer").textContent).toBe("Answered by: Code workspace (Codex)");
 renderCodingAgentAnswerFooter(bubble,"site_assistant");
 expect(bubble.querySelectorAll(".chat-mode-footer")).toHaveLength(1);
 renderCodingAgentAnswerFooter(bubble,undefined);
 expect(bubble.querySelector(".chat-mode-footer")).toBeNull();
});
