// workline_observatory_chat_adapter.js
// Starts an existing managed AI conversation with only the selected workline snapshot.
// Bridges observatory context with Queen sessions while excluding unrelated worklines and raw history.
// Exists so AI discussion stays scoped and never becomes part of immutable workline reports automatically.

import { endpoint_router } from '../endpoints/endpoint_router.js';

function bounded(value, limit) {
    return String(value || '').trim().slice(0, limit);
}

export function buildWorklineConversationPrompt(workline, releaseGoal, humanMessage) {
    const report = workline?.latest_report || {};
    const contract = workline?.release_contract || null;
    return [
        'Discuss only the selected Easelect development workline below.',
        `Workline: #${workline?.id || '-'} ${bounded(workline?.title, 300)}`,
        `Status and exact phase: ${bounded(workline?.status, 30)} / ${workline?.current_phase ?? 0}`,
        `Ticket links: ${(workline?.task_ids || []).join(', ') || 'none'}`,
        `Context: ${bounded(report.context, 1500) || 'not reported'}`,
        `Plain language: ${bounded(report.plain_language, 1800) || 'not reported'}`,
        `Technical: ${bounded(report.technical, 2200) || 'not reported'}`,
        `Next step: ${bounded(report.next_step, 1200) || 'not reported'}`,
        `Selected release goal: ${releaseGoal ? `${bounded(releaseGoal.identity_key, 80)} v${releaseGoal.version} (${bounded(releaseGoal.decision_state, 20)})` : 'none'}`,
        `Release contract: ${contract ? `${contract.completion_rule}${contract.target_phase === null ? '' : `, target phase ${contract.target_phase}`}` : 'unclassified'}`,
        `Human question: ${bounded(humanMessage, 2000)}`,
        'Do not write raw conversation text into workline reports. Suggest a structured checkpoint separately if useful.',
    ].join('\n');
}

export function startWorklineConversation(workline, releaseGoal, humanMessage) {
    const taskId = Number(workline?.task_ids?.[0]);
    const body = {
        prompt: buildWorklineConversationPrompt(workline, releaseGoal, humanMessage),
        title_hint: `Workline ${workline?.id || ''}: ${bounded(workline?.title, 120)}`,
    };
    if (Number.isInteger(taskId) && taskId > 0) body.task_id = taskId;
    return endpoint_router('queenSessions', {
        method: 'POST', body_data: body, suppressAuthRedirect: true,
    });
}
