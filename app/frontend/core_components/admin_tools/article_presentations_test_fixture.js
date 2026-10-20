// article_presentations_test_fixture.js
// Provides synthetic target-owned article snapshots to focused frontend proofs.
// Connects state and DOM tests without live datasets or storage.
import { ARTICLE_KEYS, ARTICLE_BLOCKS, articleTargetKey } from "./article_presentations_state.js";
export function articleFixture(scope = 'site') {
    const targets = (scope === 'group' ? [8,9] : [0]).map((id,index) => ({ scope,
        ...(scope === 'group' ? { group_id: id } : scope === 'personal' ? { user_id: 42 } : {}),
        members: [1,2].map(column_uid => ({ column_uid, values: Object.fromEntries(ARTICLE_KEYS.map((key,k) => [key,
            { visible: index === 0, width_px: k === 0 ? null : index * 10 + k }])) })),
        assignments: ARTICLE_KEYS.map(view_key => ({ view_key, field_set_id: 30+index, name: `Choice ${index}`, priority: scope === 'group' ? index+3 : 0 })),
    }));
    if (targets.length > 1) targets[1].members.reverse();
    return { dataset: 'e2e_articles', dataset_uid: 10, actor_id: 42, family: 'article',
        fields: [{ column_uid: 1, name: 'title', editable: true }, { column_uid: 2, name: 'body', editable: true }], targets,
        blocks: Object.fromEntries(ARTICLE_KEYS.map(key => [key, Object.fromEntries((key === 'article_view' ? ARTICLE_BLOCKS : ['details']).map(section => [section, true]))])),
        revisions: Object.fromEntries(['blocks','fields',...targets.map(articleTargetKey)].map(key => [key, `revision:${key}`])) };
}
