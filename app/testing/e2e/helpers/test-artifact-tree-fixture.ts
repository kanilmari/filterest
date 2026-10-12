/**
 * test-artifact-tree-fixture.ts
 * Adapts a response emitted by the real Go tree handler to fake API state.
 * Bridges the shared generated JSON and dataset identity/recovery regressions.
 * Keeps structural nodes in every fake response, including an empty inventory.
 */
import fixture from '../../shared_contracts/e2e_dataset_tree_response.json';

export type FixtureTreeNode = {
  id: string; name: string; parent_id: string; db_id: number;
  table_uid?: unknown; is_view?: boolean;
};

export const serverTreeResponse = fixture as { nodes: FixtureTreeNode[]; column_details: unknown };
const datasetTemplate = serverTreeResponse.nodes.find(node => node.id === 't_e2e_recorded')!;

/** Retains the handler's dataset fields while allowing intentional identity corruption. */
export function datasetTreeNode(name: string, uid: unknown): FixtureTreeNode {
  const template = serverTreeResponse.nodes.find(node => node.id === `t_${name}`) ?? datasetTemplate;
  return { ...template, id: `t_${name}`, name, table_uid: uid };
}

/** Folders, Views root and raw views come from handler output, never handwritten copies. */
export function treeResponseWithDatasetNodes(nodes: unknown[]) {
  return { ...serverTreeResponse, nodes: [
    ...serverTreeResponse.nodes.filter(node => node.id.startsWith('f_')),
    ...nodes,
    ...serverTreeResponse.nodes.filter(node => !node.id.startsWith('f_') && !node.id.startsWith('t_')),
  ] };
}

export function treeResponseForDatasets(datasets: Record<string, { uid: unknown }>) {
  return treeResponseWithDatasetNodes(Object.entries(datasets)
    .map(([name, dataset]) => datasetTreeNode(name, String(dataset.uid))));
}
