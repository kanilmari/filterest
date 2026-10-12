"""test_pipeline_documentation.py
Check the documented backend stage names against their canonical execution order.
Connect the architecture guide's stage table to pipeline_order.go.
Prevent added, removed or reordered stages from leaving stale guidance behind.
"""

import re
from pathlib import Path


APP = Path(__file__).resolve().parents[2]


def test_backend_pipeline_documentation_matches_stage_order():
    source = (APP / "backend/pipeline/pipeline_order.go").read_text(encoding="utf-8")
    stage_definition = source.split("var PipelineOrder = []Stage{", 1)[1].split("\n}", 1)[0]
    # Anchoring to a field excludes the commented-out future stages.
    actual = re.findall(r'^\s*Name:\s*"([^"]+)"', stage_definition, re.MULTILINE)
    assert actual, "No stages found in PipelineOrder"

    guide = (APP / "docs/instructions_and_documentation/Pipeline_Architecture.md").read_text(
        encoding="utf-8"
    )
    order_section = guide.split("## 3. Pipeline Order\n", 1)[1].split("\n## ", 1)[0]
    # Scope numbered rows to the backend table, excluding the frontend tables.
    documented = re.findall(
        r'^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|', order_section, re.MULTILINE
    )
    assert documented == actual, "Pipeline Architecture stage names/order differ from PipelineOrder"
