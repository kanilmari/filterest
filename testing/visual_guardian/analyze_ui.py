"""
analyze_ui.py — Visual Guardian AI Analysis Tool
Sends screenshots to a vision-capable AI model (Anthropic/OpenAI) for automated
UI regression detection against the Design Constitution. Supports contextual
analysis via --context flag for agent-driven feedback loops.
"""

import os
import base64
import json
import glob
import sys
import argparse
from pathlib import Path
from openai import OpenAI
from anthropic import Anthropic
from dotenv import load_dotenv
import re

# Load the native source checkout from its external key root. Generated and
# deployed runtimes continue to resolve their own root-local environment files.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server_tools.lib.easelect_private_paths import resolve_easelect_private_paths


try:
    private_paths = resolve_easelect_private_paths(PROJECT_ROOT)
    load_dotenv(private_paths.development_env_file, override=False)
    load_dotenv(private_paths.runtime_env_file, override=False)
except Exception as e:
    print(f"Warning: Could not load native Easelect environment files: {e}")

CONFIG_PATH = "docs/constitution/design/technical_definitions.md"
PRINCIPLES_PATH = "docs/constitution/design/README.md"
SCREENSHOTS_DIRS = ["testing/test-results/visual_guardian", "testing/my-test-results/visual_guardian"]
REPORT_FILE = "testing/test-results/visual_guardian/report.json"

# Visual Guardian model configuration
VISUAL_GUARDIAN_MODEL = (
    os.getenv("VISUAL_GUARDIAN_MODEL")
    or os.getenv("OPENAI_VISION_MODEL")
    or os.getenv("OPENAI_API_MODEL")
    or "gpt-5.2"
)

def _parse_json_response(text: str):
    """Best-effort JSON parsing for model outputs."""
    try:
        return json.loads(text)
    except Exception:
        # Some models may wrap JSON in prose; extract the first JSON object.
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def load_file_content(path):
    if not os.path.exists(path):
        return f"Error: File {path} not found."
    with open(path, "r") as f:
        return f.read()

def analyze_screenshot(client, client_type, image_path, rules, principles, question, context=None, mock=False):
    """Analyze a screenshot using AI vision. Optionally includes context (goal/changes) for targeted analysis."""
    image_name = os.path.basename(image_path)
    
    if mock:
        return {
            "status": "PASS",
            "device_detected": "unknown (mock)",
            "matches_intent": True,
            "elements_detected": [],
            "issues": [],
            "reasoning": "Mock analysis: The layout appears to respect the defined rules (Simulated)."
        }

    base64_image = encode_image(image_path)
    media_type = "image/png"

    # Build prompt with optional context block
    context_block = ""
    if context:
        context_block = f"""
    CHANGE CONTEXT (what the developer just did and why):
    {context}
    
    Use this context to focus your analysis. Check whether the described changes
    are visually reflected correctly in the screenshot.
    """

    question_block = ""
    if question:
        question_block = f"""
    SPECIFIC QUESTION:
    "{question}"
    Answer this question explicitly in the reasoning field.
    """

    prompt = f"""You are the Visual AI Guardian, an automated QA system for the 'Easelect' application.
    Your role is to see what is on screen and evaluate it against rules and context.

    {context_block}

    IMAGE INFO:
    - Filename: {image_name} (may indicate device/viewport, e.g., 'mobile', 'desktop')
    
    DESIGN CONSTITUTION:
    
    === PRINCIPLES (The Spirit of the Law) ===
    {principles}
    
    === TECHNICAL RULES (The Letter of the Law) ===
    {rules}
    
    ANALYSIS INSTRUCTIONS:
    1. Identify the viewport/device based on the image aspect ratio and filename.
    2. Describe key UI elements you see (navbar, search bar, filters, content area, buttons).
    3. Check for layout violations specific to that viewport.
    4. Check for color palette, spacing, and alignment issues.
    5. CRITICAL: Check if any overlay is obscuring content or behaving unexpectedly.
    6. If change context was provided, assess whether the intended changes are correctly reflected.
    {question_block}
    
    OUTPUT FORMAT:
    Return a valid JSON object with exactly this structure:
    {{
        "status": "PASS" | "FAIL" | "WARNING",
        "device_detected": "mobile" | "tablet" | "desktop",
        "matches_intent": true | false,
        "elements_detected": [
            "navbar with back/forward buttons (disabled)",
            "search bar (centered, full width)",
            "filterbar (collapsed)"
        ],
        "issues": [
            "Description of issue 1"
        ],
        "reasoning": "Detailed explanation. Answer any specific question here. Assess intent match if context was provided. Use double newlines (\\n\\n) to separate paragraphs."
    }}
    
    If status is PASS, issues should be empty. Set matches_intent to true if the
    screenshot reflects the described changes correctly (or true if no context was given).
    elements_detected should list the major UI components you observe."""

    try:
        if client_type == "anthropic":
            message = client.messages.create(
                model="claude-opus-4-5",
                max_tokens=1000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": base64_image,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ],
                    }
                ]
            )
            content = message.content[0].text
            return _parse_json_response(content)
            
        else: # OpenAI
            response = client.chat.completions.create(
                model=VISUAL_GUARDIAN_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}"
                                },
                            },
                        ],
                    }
                ],
                max_tokens=1000,
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            return _parse_json_response(content)

    except Exception as e:
        print(f"Error analyzing {image_name}: {e}")
        return {
            "status": "ERROR",
            "issues": [str(e)],
            "reasoning": "API call failed."
        }

def main():
    parser = argparse.ArgumentParser(
        description="Visual AI Guardian — Screenshot Analysis with AI Vision",
        epilog="Examples:\n"
               "  python analyze_ui.py --question 'Is the navbar visible?'\n"
               "  python analyze_ui.py --screenshot path/to/image.png --context 'Added back/forward buttons'\n"
               "  python analyze_ui.py --screenshot screenshots/ --context 'Refactored filterbar' --question 'Is spacing correct?'\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--question", type=str, default=None,
                        help="Specific question for the AI to answer about the screenshot(s)")
    parser.add_argument("--context", type=str, default=None,
                        help="What was changed and why (e.g., 'Added back/forward nav buttons to the navbar'). "
                             "Helps the AI focus on evaluating the intended change.")
    parser.add_argument("--screenshot", type=str, default=None,
                        help="Path to a specific screenshot file or directory. "
                             "If omitted, uses default Visual Guardian screenshot directories.")
    args = parser.parse_args()

    # if not os.path.exists(SCREENSHOTS_DIR):
    #     print(f"Error: Directory {SCREENSHOTS_DIR} not found. Run Playwright tests first.")
    #     sys.exit(1)

    client = None
    client_type = None

    # Try OpenAI first (preferred — prepaid credits), Anthropic as fallback
    openai_key = os.environ.get("OPENAI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if openai_key:
         client = OpenAI(api_key=openai_key)
         client_type = "openai"
    elif anthropic_key and "sk-ant" in anthropic_key:
         client = Anthropic(api_key=anthropic_key)
         client_type = "anthropic"
    else:
        print("Error: No valid API keys found (OPENAI_API_KEY or ANTHROPIC_API_KEY).")
        sys.exit(1)

    rules = load_file_content(CONFIG_PATH)
    principles = load_file_content(PRINCIPLES_PATH)
    
    # Resolve screenshots: --screenshot flag or default directories
    screenshots = []
    if args.screenshot:
        if os.path.isfile(args.screenshot):
            screenshots = [args.screenshot]
        elif os.path.isdir(args.screenshot):
            screenshots = glob.glob(os.path.join(args.screenshot, "*.png"))
        else:
            print(f"Error: --screenshot path not found: {args.screenshot}")
            sys.exit(1)
    else:
        for d in SCREENSHOTS_DIRS:
            screenshots.extend(glob.glob(os.path.join(d, "*.png")))
    
    if not screenshots:
        print("No screenshots found. Take screenshots first (e.g., npx playwright test capture_screens.spec.ts)")
        sys.exit(1)
        
    full_report = {
        "summary": "Visual Guardian Analysis",
        "context": args.context,
        "question": args.question,
        "results": []
    }

    print("\n--- Screenshots to be analyzed ---")
    for s in screenshots:
        print(f"  {s}")

    if args.context:
        print(f"\n--- Context ---")
        print(f"  {args.context}")

    if args.question:
        print(f"\n--- Question ---")
        print(f"  {args.question}")
    
    for screenshot in screenshots:
        result = analyze_screenshot(
            client, client_type, screenshot, rules, principles,
            question=args.question, context=args.context, mock=False
        )
        full_report["results"].append({
            "image": os.path.basename(screenshot),
            "analysis": result
        })
        
        # Print structured output for terminal consumption
        status = result.get("status", "?")
        intent = result.get("matches_intent", "?")
        elements = result.get("elements_detected", [])
        
        print(f"\n--- {os.path.basename(screenshot)} ---")
        print(f"  Status: {status} | Intent Match: {intent}")
        if elements:
            print(f"  Elements: {', '.join(elements[:5])}")
        issues = result.get("issues", [])
        if issues:
            print(f"  Issues:")
            for issue in issues:
                print(f"    - {issue}")
        print(f"  Reasoning: {result.get('reasoning', 'No reasoning provided.')}")

    # Determine report file path
    report_path = REPORT_FILE
    if args.screenshot and os.path.isdir(args.screenshot):
        report_path = os.path.join(args.screenshot, "report.json")
    
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)
    print(f"\nReport saved to {report_path}")

if __name__ == "__main__":
    main()
