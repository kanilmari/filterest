// @vitest-environment jsdom
// table_chat_query_runner.test.js
// Verifies durable coding-agent jobs in both modes, their saved mode and recovery.
// Bridges accepted job IDs, routed polling, cancellation and page recovery.
// No test starts a model or writes application data.
import {beforeEach,expect,test,vi} from "vitest";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../../endpoints/endpoint_router.js",()=>({endpoint_router:request}));
vi.mock("../../route_permission_checker.js",()=>({hasRoutePermission:()=>true}));
vi.mock("../../../ui_config.js",()=>({FILTERBAR_AI_CHAT_MODE:"api_tools"}));
vi.mock("../../table_views/dataset_view_printer.js",()=>({generate_table:vi.fn()}));
vi.mock("../../infinite_scroll/infinite_scroll_handler.js",()=>({disconnectInfiniteScroll:vi.fn(),resetOffset:vi.fn(),updateOffset:vi.fn()}));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js",()=>({getUnifiedTableState:()=>({}),setUnifiedTableState:vi.fn(),refreshTableUnified:vi.fn()}));
vi.mock("../../navigation/nav_engine/query_params.js",()=>({getParams:()=>({}),setParams:vi.fn(),updateURL:vi.fn()}));
vi.mock("../../filterbar/top_row_buttons/sort_sync_state.js",()=>({emitDatasetSortSelection:vi.fn()}));
vi.mock("../../filterbar/text_search/dataset_search_executor.js",()=>({hasCachedSearchResults:()=>false,sortCachedSearchResults:vi.fn()}));
import {runCodingAgentChatQuery,hasPendingCodingAgentJob,pendingCodingAgentJobMode,cancelCodingAgentPolling} from "./table_chat_query_runner.js";
const id="00000000-0000-0000-0000-000000000042";
beforeEach(()=>{request.mockReset();localStorage.clear();document.documentElement.lang="en";});
test.each(["code_workspace","site_assistant"])("a %s job sends its mode, polls its exact dataset and clears completed state",async mode=>{
 request.mockResolvedValueOnce({job_id:id,status:"queued",mode}).mockResolvedValueOnce({job_id:id,status:"completed",answer:"Changed fixture",mode});
 const result=await runCodingAgentChatQuery("fixture","fix",[],{mode});
 expect(request.mock.calls[0][1]).toMatchObject({method:"POST",body_data:{mode,dataset:"fixture",query:"fix"}});
 expect(result).toMatchObject({answer:"Changed fixture",mode});
 expect(request.mock.calls[1][1]).toMatchObject({method:"GET",url_params:"?dataset=fixture&job_id="+id});
 expect(hasPendingCodingAgentJob("fixture")).toBe(false);
});
test("a lost acceptance response retains identity and mode, and reopening polls without resubmitting",async()=>{
 request.mockRejectedValueOnce(new Error("connection lost"));
 await expect(runCodingAgentChatQuery("fixture","fix",[],{mode:"code_workspace"})).rejects.toThrow("connection lost");
 const pending=JSON.parse(localStorage.getItem("codingAgentJob_fixture"));
 expect(pending.job_id).toMatch(/^[a-f0-9-]{36}$/);
 expect(pendingCodingAgentJobMode("fixture")).toBe("code_workspace");
 request.mockResolvedValueOnce({job_id:pending.job_id,status:"completed",answer:"Recovered"});
 const recovered=await runCodingAgentChatQuery("fixture","");
 expect(recovered).toMatchObject({answer:"Recovered",mode:"code_workspace"});
 expect(request.mock.calls.filter(([,o])=>o.method==="POST")).toHaveLength(1);
});
test("closing the view aborts polling but retains the accepted job for reopening",async()=>{
 localStorage.setItem("codingAgentJob_fixture",JSON.stringify({job_id:id,mode:"site_assistant"}));
 request.mockResolvedValue({job_id:id,status:"running"});
 const promise=runCodingAgentChatQuery("fixture","");const rejection=expect(promise).rejects.toMatchObject({name:"AbortError"});
 await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());
 cancelCodingAgentPolling("fixture");await rejection;
 expect(hasPendingCodingAgentJob("fixture")).toBe(true);
});
test("forbidden job from a different signed-in actor is not retained or exposed",async()=>{
 localStorage.setItem("codingAgentJob_fixture",JSON.stringify({job_id:id}));
 request.mockRejectedValue(Object.assign(new Error("forbidden"),{status:403}));
 await expect(runCodingAgentChatQuery("fixture","")).rejects.toThrow("forbidden");
 expect(hasPendingCodingAgentJob("fixture")).toBe(false);
});
test("a refused mode forgets the saved job so the next question starts fresh",async()=>{
 request.mockRejectedValueOnce(Object.assign(new Error("Code workspace mode is available only in development"),{status:403}));
 await expect(runCodingAgentChatQuery("fixture","edit",[],{mode:"code_workspace"})).rejects.toThrow("only in development");
 expect(hasPendingCodingAgentJob("fixture")).toBe(false);
});
