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
import { createCodingAgentControl } from "./table_chat_coding_agent_control.js";
beforeEach(() => {
 document.head.innerHTML='<meta name="app-env" content="prod">';
 document.documentElement.lang="fi";document.body.innerHTML="";localStorage.clear();
 request.mockReset();permission.mockReturnValue(true);
});
test("ordinary users do not receive or request coding controls", () => {
 permission.mockReturnValue(false);
 expect(createCodingAgentControl("fixture")).toBeNull();expect(request).not.toHaveBeenCalled();
});
test("enabled production with an unready runner explains setup without allowing sends", async () => {
 request.mockResolvedValue({feature_enabled:true,runner_ready:false,dev_only:false});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.row.hidden).toBe(false));
 await vi.waitFor(()=>expect(control.row.textContent).toContain("ei ole valmis"));
 expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(true);
 expect(request).toHaveBeenCalledWith("aiChatCodexQuery",expect.objectContaining({method:"GET",url_params:"dataset=fixture"}));
 expect(request.mock.calls.every(([, options])=>options.method==="GET")).toBe(true);
 control.destroy();
});
test("ready production selection persists and FI to EN keeps focus and value", async () => {
 request.mockResolvedValue({feature_enabled:true,runner_ready:true,runner_kind:"external"});
 const control=createCodingAgentControl("fixture");document.body.append(control.row);
 await vi.waitFor(()=>expect(control.select.querySelector('[value="codex_dev"]').disabled).toBe(false));
 control.select.value="codex_dev";control.select.dispatchEvent(new Event("change"));control.select.focus();
 document.documentElement.lang="en";
 await vi.waitFor(()=>expect(control.row.textContent).toContain("Coding agent (Codex)"));
 expect(control.select.value).toBe("codex_dev");expect(document.activeElement).toBe(control.select);
 expect(localStorage.getItem("gptChatMode_fixture")).toBe("codex_dev");
 control.destroy();
});
test("a late availability response cannot revive destroyed controls", async () => {
 let resolve;request.mockReturnValue(new Promise(done=>{resolve=done;}));
 const control=createCodingAgentControl("fixture");control.destroy();
 resolve({feature_enabled:true,runner_ready:true});
 await Promise.resolve();expect(control.capability).toBeUndefined();expect(control.row.hidden).toBe(true);
});
