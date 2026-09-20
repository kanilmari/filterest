// @vitest-environment jsdom
// table_chat_coding_agent_control.test.js
// Verifies admin-only policy/readiness controls without starting coding jobs.
// Bridges translated UI, asynchronous capabilities and existing preferences.
// Keeps disabled production setup distinct from a working runner.
import { beforeEach, expect, test, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
const permission = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: request }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: permission }));
vi.mock("../../../ui_config.js", () => ({ FILTERBAR_AI_CHAT_MODE: "api_tools" }));
// The control reads its copy from the site's language keys; the fixture answers
// Finnish for one key and lets the rest fall back to the built-in English.
const translations = vi.hoisted(() => new Map());
vi.mock("../../lang/translation_handler.js", () => ({
 getTranslationForKey: (key, { fallback } = {}) => translations.get(key) ?? fallback,
}));
import { createCodingAgentControl } from "./table_chat_coding_agent_control.js";
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
 await vi.waitFor(()=>expect(control.capability).toEqual({feature_enabled:false,runner_ready:false}));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(true);
 expect(request).toHaveBeenCalledWith("aiChatCodexQuery",expect.objectContaining({suppressAuthRedirect:true}));
 control.destroy();
});
test("enabled production with an unready runner explains setup without allowing sends", async () => {
 translations.set("coding_agent_not_ready","Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.");
 request.mockResolvedValue({feature_enabled:true,runner_ready:false,dev_only:false});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.row.hidden).toBe(false));
 await vi.waitFor(()=>expect(control.row.textContent).toContain("ei ole valmis"));
 expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(true);
 expect(request).toHaveBeenCalledWith("aiChatCodexQuery",expect.objectContaining({method:"GET",url_params:"?dataset=fixture"}));
 expect(request.mock.calls.every(([, options])=>options.method==="GET")).toBe(true);
 control.destroy();
});
test.each(["light","dark"])("ready site-assistant selection is explicit in the %s theme and survives FI to EN", async theme => {
 document.documentElement.dataset.theme=theme;
 translations.set("site_assistant_api_label","Sivustoavustaja (vain sivuston API)");
 request.mockResolvedValue({feature_enabled:true,runner_ready:true,runner_kind:"external"});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(false));
 expect(control.row.textContent).toContain("Sivustoavustaja (vain sivuston API)");
 control.select.value="codex_dev";control.select.dispatchEvent(new Event("change"));control.select.focus();
 translations.delete("site_assistant_api_label");
 document.documentElement.lang="en";
 await vi.waitFor(()=>expect(control.row.textContent).toContain("Site assistant (site API only)"));
 expect(control.row.textContent).toContain("AI service");
 expect(control.select.value).toBe("codex_dev");expect(document.activeElement).toBe(control.select);
 expect(localStorage.getItem("gptChatMode_fixture")).toBe("codex_dev");
 control.destroy();
});
test("ready development selection names the repository-capable agent", async () => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 translations.set("coding_agent_repository_label","Repositorioagentti (Codex)");
 request.mockResolvedValue({feature_enabled:true,runner_ready:true,runner_kind:"legacy_dev"});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(false));
 expect(control.row.textContent).toContain("Repositorioagentti (Codex)");
 translations.delete("coding_agent_repository_label");
 document.documentElement.lang="en";
 await vi.waitFor(()=>expect(control.row.textContent).toContain("Repository agent (Codex)"));
 control.destroy();
});
test("a late availability response cannot revive destroyed controls", async () => {
 let resolve;request.mockReturnValue(new Promise(done=>{resolve=done;}));
 const control=createCodingAgentControl("fixture");control.destroy();
 resolve({feature_enabled:true,runner_ready:true});
 await Promise.resolve();expect(control.capability).toBeUndefined();expect(control.row.hidden).toBe(true);
});


test("fresh administrator availability recovers missing route cache without early visibility", async () => {
 permission.mockReturnValue(false);
 let resolve;request.mockReturnValue(new Promise(done=>{resolve=done;}));
 const control=createCodingAgentControl("fixture");
 expect(control).not.toBeNull();
 document.body.append(control.row);
 expect(control.row.hidden).toBe(true);
 expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(true);
 resolve({feature_enabled:true,runner_ready:false,dev_only:false});
 await vi.waitFor(()=>expect(control.row.hidden).toBe(false));
 expect(control.row.textContent).toContain("is not ready");
 expect(control.select.value).toBe("api_tools");
 expect(request.mock.calls).toHaveLength(1);
 control.destroy();
});

test.each([401,403,503])("failed availability %s cannot enable a stored DEV choice", async status => {
 document.head.innerHTML='<meta name="app-env" content="dev">';
 localStorage.setItem("gptChatMode_fixture","codex_dev");
 request.mockRejectedValue(Object.assign(new Error("Unavailable"),{status}));
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.capability?.feature_enabled).toBe(false));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(true);
 control.destroy();
});

test("production policy restriction hides the service even with a ready runner", async () => {
 request.mockResolvedValue({feature_enabled:false,runner_ready:true,dev_only:true});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.capability?.dev_only).toBe(true));
 expect(control.row.hidden).toBe(true);
 expect(control.select.value).toBe("api_tools");
 control.destroy();
});
