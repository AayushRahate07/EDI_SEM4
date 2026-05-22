"""
sop_parser.py — LLM SOP Parser
================================
Takes a plain-text SOP document, sends it to an LLM (OpenAI or Anthropic),
and returns a validated, human-reviewed SopDag dict that matches the Zod
schema defined in sop-engine/src/schemas/sop.schema.ts.

DAG Node types produced
-----------------------
  MEASUREMENT   — a weighing / temperature / volume step
  VERIFICATION  — a material / identity / PPE check step
  DECISION_BRANCH — a conditional branch (pass / fail / retry)

Quick-start
-----------
  from sop_parser import parse_sop, push_dag_to_engine
  import pathlib

  sop_text = pathlib.Path("my_sop.txt").read_text()

  # 1. Parse & review (blocks for human input in terminal)
  dag = parse_sop(sop_text)

  # 2. Push to sop-engine (creates template in DB)
  push_dag_to_engine(dag, engine_url="http://localhost:3000")

Environment variables
---------------------
  GEMINI_API_KEY    — Google Gemini API key (students.google.com / AI Studio)
  OPENAI_API_KEY    — set this OR one of the above
  ANTHROPIC_API_KEY — used when neither GEMINI nor OPENAI key is present
  SOP_ENGINE_URL    — default engine URL (overrides the param default)

The human review step prints the generated DAG to stdout in a rich
tree view, then asks yes/no before locking it.  In CI / automated
pipelines pass `skip_review=True` to push_dag_to_engine().
"""

from __future__ import annotations

import json
import os
import re
import textwrap
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import requests


# ─────────────────────────────────────────────────────────────────
# Prompt template
# ─────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = textwrap.dedent("""\
You are a pharmaceutical SOP analyst.
Your job is to convert a plain-text Standard Operating Procedure into a
structured JSON workflow DAG that a compliance engine can execute.

Return ONLY a raw JSON object — no markdown fences, no preamble.

JSON Schema
-----------
{
  "template_id": "<slug, e.g. SOP-KETOPROFEN-001>",
  "version": "1.0.0",
  "start_node_id": "<id of the first node>",
  "nodes": [
    // MEASUREMENT node
    {
      "id": "<unique string, e.g. step_weigh_api_1>",
      "type": "MEASUREMENT",
      "title": "<human-readable step title>",
      "x": <number>,
      "y": <number>,
      "config": {
        "target_value": <positive number>,
        "unit": "mg" | "g" | "ml" | "C",
        "tolerance_positive": <non-negative number>,
        "tolerance_negative": <non-negative number>
      },
      "next_nodes": ["<next_node_id or WORKFLOW_COMPLETE>"]
    },
    // VERIFICATION node
    {
      "id": "<unique string>",
      "type": "VERIFICATION",
      "title": "<human-readable step title>",
      "x": <number>,
      "y": <number>,
      "config": {
        "entity_name": "<name of material or person attribute>",
        "mode": "MANUAL_ENTRY" | "BARCODE" | "POST_HOC_VISION",
        "confidence_threshold": <0.0–1.0, optional>,
        "yolo_class_name": "<COCO class string, optional, only for POST_HOC_VISION>"
      },
      "next_nodes": ["<next_node_id or WORKFLOW_COMPLETE>"]
    },
    // DECISION_BRANCH node
    {
      "id": "<unique string>",
      "type": "DECISION_BRANCH",
      "title": "<e.g. Weight in range?>",
      "x": <number>,
      "y": <number>,
      "config": {
        "condition_field": "<field to branch on, e.g. ppeStatus>"
      },
      "next_nodes": {
        "PASS":  "<next_node_id or WORKFLOW_COMPLETE>",
        "FAIL":  "<next_node_id or WORKFLOW_COMPLETE>",
        "RETRY": "<node_id to loop back to>"
      }
    }
  ]
}

Rules
-----
1. Every node id must be unique and contain only [a-z0-9_].
2. next_nodes must reference an existing node id OR the special string
   "WORKFLOW_COMPLETE" which terminates the workflow.
3. For PPE / gowning checks use type=VERIFICATION with
   mode=POST_HOC_VISION and yolo_class_name set to the relevant COCO
   class (e.g. "person").
4. For raw-material identity checks prefer mode=BARCODE.
5. Lay nodes out roughly top-to-bottom: increment y by 120 per step,
   set x=400 for the main path.  Branch nodes use x=200 (FAIL path)
   and x=600 (RETRY path).
6. Include at minimum: one VERIFICATION for PPE/gowning at the start,
   then each weighing or procedural step, then a final VERIFICATION
   for second-person sign-off.
""")

_USER_TEMPLATE = "SOP document:\n\n{sop_text}\n\nConvert this SOP to the JSON DAG now."


# ─────────────────────────────────────────────────────────────────
# LLM backends
# ─────────────────────────────────────────────────────────────────

def _call_openai(sop_text: str, model: str = "gpt-4o") -> str:
    """Call OpenAI chat completions and return raw response text."""
    import openai  # pip install openai
    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _USER_TEMPLATE.format(sop_text=sop_text)},
        ],
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


def _call_anthropic(sop_text: str, model: str = "claude-sonnet-4-20250514") -> str:
    """Call Anthropic Messages API and return raw response text."""
    import anthropic  # pip install anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _USER_TEMPLATE.format(sop_text=sop_text),
            }
        ],
    )
    return message.content[0].text


def _call_gemini(sop_text: str, model: str = "gemini-2.5-flash") -> str:
    """Call Google Gemini API and return raw response text (JSON mode)."""
    from google import genai  # pip install google-genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    prompt = f"{_SYSTEM_PROMPT}\n\n{_USER_TEMPLATE.format(sop_text=sop_text)}"

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    return response.text


def _call_llm(sop_text: str) -> str:
    """Auto-select backend based on available env vars (Gemini → OpenAI → Anthropic)."""
    if os.environ.get("GEMINI_API_KEY"):
        return _call_gemini(sop_text)
    if os.environ.get("OPENAI_API_KEY"):
        return _call_openai(sop_text)
    if os.environ.get("ANTHROPIC_API_KEY"):
        return _call_anthropic(sop_text)
    raise EnvironmentError(
        "No LLM API key found. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
    )


# ─────────────────────────────────────────────────────────────────
# JSON cleanup & extraction
# ─────────────────────────────────────────────────────────────────

def _extract_json(raw: str) -> dict:
    """
    Robustly extract a JSON object from LLM output.
    Handles markdown fences, leading prose, and minor trailing garbage.
    """
    # Strip markdown code fences
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    # Find the first '{' and the matching '}'
    start = raw.find("{")
    if start == -1:
        raise ValueError("No JSON object found in LLM response.")

    # Walk to find balanced closing brace
    depth = 0
    end = start
    for i, ch in enumerate(raw[start:], start=start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    else:
        end = len(raw)

    return json.loads(raw[start:end])


# ─────────────────────────────────────────────────────────────────
# Validation (mirrors Zod schema from sop.schema.ts)
# ─────────────────────────────────────────────────────────────────

class SopValidationError(ValueError):
    pass


def _validate_dag(dag: dict) -> None:
    """
    Python-side validation that mirrors the Zod SopDagSchema:
    - Required top-level keys
    - Each node has a valid type
    - start_node_id exists in nodes
    - All next_nodes targets exist in nodes or are WORKFLOW_COMPLETE
    """
    for key in ("template_id", "version", "start_node_id", "nodes"):
        if key not in dag:
            raise SopValidationError(f"Missing required key: {key!r}")

    if not dag["nodes"]:
        raise SopValidationError("nodes array must not be empty")

    node_ids: set[str] = {n["id"] for n in dag["nodes"]}

    if dag["start_node_id"] not in node_ids:
        raise SopValidationError(
            f"start_node_id {dag['start_node_id']!r} not found in nodes"
        )

    valid_types = {"MEASUREMENT", "VERIFICATION", "DECISION_BRANCH"}
    terminal = "WORKFLOW_COMPLETE"

    for node in dag["nodes"]:
        nid = node.get("id", "<missing>")

        # Type check
        ntype = node.get("type")
        if ntype not in valid_types:
            raise SopValidationError(f"Node {nid!r} has invalid type {ntype!r}")

        # next_nodes check
        next_nodes = node.get("next_nodes", [])
        if ntype == "DECISION_BRANCH":
            if not isinstance(next_nodes, dict):
                raise SopValidationError(
                    f"DECISION_BRANCH node {nid!r} must have next_nodes as object"
                )
            for condition, target in next_nodes.items():
                if target != terminal and target not in node_ids:
                    raise SopValidationError(
                        f"Node {nid!r} condition {condition!r} → unknown target {target!r}"
                    )
        else:
            if not isinstance(next_nodes, list):
                raise SopValidationError(
                    f"Node {nid!r} next_nodes must be an array"
                )
            for target in next_nodes:
                if target != terminal and target not in node_ids:
                    raise SopValidationError(
                        f"Node {nid!r} → unknown target {target!r}"
                    )

        # Config checks
        cfg = node.get("config", {})
        if ntype == "MEASUREMENT":
            for field in ("target_value", "unit", "tolerance_positive", "tolerance_negative"):
                if field not in cfg:
                    raise SopValidationError(
                        f"MEASUREMENT node {nid!r} missing config.{field}"
                    )
            if cfg["unit"] not in ("mg", "g", "ml", "C"):
                raise SopValidationError(
                    f"MEASUREMENT node {nid!r} has invalid unit {cfg['unit']!r}"
                )
        elif ntype == "VERIFICATION":
            for field in ("entity_name", "mode"):
                if field not in cfg:
                    raise SopValidationError(
                        f"VERIFICATION node {nid!r} missing config.{field}"
                    )
            if cfg["mode"] not in ("BARCODE", "MANUAL_ENTRY", "POST_HOC_VISION"):
                raise SopValidationError(
                    f"VERIFICATION node {nid!r} has invalid mode {cfg['mode']!r}"
                )


# ─────────────────────────────────────────────────────────────────
# Human review step
# ─────────────────────────────────────────────────────────────────

def _print_dag_tree(dag: dict) -> None:
    """Pretty-print the DAG as a node tree to stdout."""
    nodes_by_id = {n["id"]: n for n in dag["nodes"]}
    terminal = "WORKFLOW_COMPLETE"

    print("\n" + "=" * 60)
    print("  GENERATED SOP DAG — HUMAN REVIEW")
    print("=" * 60)
    print(f"  Template ID : {dag['template_id']}")
    print(f"  Version     : {dag['version']}")
    print(f"  Start node  : {dag['start_node_id']}")
    print(f"  Total nodes : {len(dag['nodes'])}")
    print("-" * 60)

    # Walk from start
    visited: set[str] = set()
    queue = [dag["start_node_id"]]
    step = 1

    while queue:
        nid = queue.pop(0)
        if nid in visited or nid == terminal:
            continue
        visited.add(nid)
        node = nodes_by_id.get(nid)
        if node is None:
            print(f"  [{step:02d}] ??? {nid!r} (node not found)")
            step += 1
            continue

        ntype = node["type"]
        title = node.get("title", "—")
        cfg   = node.get("config", {})

        if ntype == "MEASUREMENT":
            detail = (
                f"{cfg.get('target_value')} {cfg.get('unit')} "
                f"±{cfg.get('tolerance_positive')}/{cfg.get('tolerance_negative')}"
            )
        elif ntype == "VERIFICATION":
            detail = f"{cfg.get('entity_name')} [{cfg.get('mode')}]"
            if cfg.get("yolo_class_name"):
                detail += f" yolo={cfg['yolo_class_name']!r}"
        else:
            detail = f"branch on {cfg.get('condition_field')!r}"

        print(f"  [{step:02d}] {ntype:<18}  {title}")
        print(f"        id: {nid}   →  {detail}")

        # Enqueue next
        next_nodes = node.get("next_nodes", [])
        if isinstance(next_nodes, dict):
            for cond, target in next_nodes.items():
                print(f"        [{cond}] → {target}")
                if target not in visited and target != terminal:
                    queue.append(target)
        else:
            for target in next_nodes:
                print(f"        → {target}")
                if target not in visited and target != terminal:
                    queue.append(target)

        step += 1

    # Print unreferenced nodes (shouldn't happen with a valid DAG)
    unreachable = [n["id"] for n in dag["nodes"] if n["id"] not in visited]
    if unreachable:
        print(f"\n  ⚠  Unreachable nodes: {unreachable}")

    print("=" * 60)


def _human_review(dag: dict) -> dict:
    """
    Display the DAG tree, then prompt the operator to approve, edit, or reject.
    Returns the (possibly edited) dag after approval.

    Supported actions at the prompt:
      y / yes     → approve and lock the DAG
      n / no      → abort; raises RuntimeError
      e / edit    → open $EDITOR with the JSON for inline editing
      s / show    → re-print the tree
      j / json    → print raw JSON
    """
    _print_dag_tree(dag)

    while True:
        print(
            "\nActions:\n"
            "  [y]es   — approve and lock this DAG\n"
            "  [n]o    — abort (do not push)\n"
            "  [e]dit  — open in $EDITOR for manual JSON edit\n"
            "  [s]how  — re-print the DAG tree\n"
            "  [j]son  — print raw JSON\n"
        )
        choice = input("Your choice: ").strip().lower()

        if choice in ("y", "yes"):
            print("  ✔ DAG approved.")
            return dag

        elif choice in ("n", "no"):
            raise RuntimeError("Human reviewer rejected the DAG. Aborting.")

        elif choice in ("e", "edit"):
            dag = _edit_in_editor(dag)
            try:
                _validate_dag(dag)
                print("  ✔ Edited DAG passes validation.")
                _print_dag_tree(dag)
            except SopValidationError as exc:
                print(f"  ✗ Validation error after edit: {exc}")

        elif choice in ("s", "show"):
            _print_dag_tree(dag)

        elif choice in ("j", "json"):
            print(json.dumps(dag, indent=2))

        else:
            print("  Unknown choice. Type y, n, e, s, or j.")


def _edit_in_editor(dag: dict) -> dict:
    """Write dag to a temp file, open $EDITOR, return parsed result."""
    import tempfile, subprocess
    editor = os.environ.get("EDITOR", "nano")
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as tmp:
        json.dump(dag, tmp, indent=2)
        tmp_path = tmp.name
    subprocess.call([editor, tmp_path])
    with open(tmp_path) as fh:
        return json.load(fh)


# ─────────────────────────────────────────────────────────────────
# Retry + repair loop
# ─────────────────────────────────────────────────────────────────

def _repair_dag(dag: dict, error: str) -> dict:
    """
    Ask the LLM to fix a validation error.
    Passes the broken JSON and the error message back for a single repair pass.
    """
    repair_prompt = (
        f"The JSON DAG you produced has a validation error:\n\n"
        f"{error}\n\n"
        f"Here is the broken DAG:\n\n"
        f"{json.dumps(dag, indent=2)}\n\n"
        f"Return the corrected JSON object only. No prose, no fences."
    )
    raw = _call_llm(repair_prompt)
    return _extract_json(raw)


# ─────────────────────────────────────────────────────────────────
# Main public API
# ─────────────────────────────────────────────────────────────────

def parse_sop(
    sop_text: str,
    *,
    max_retries: int = 3,
    skip_review: bool = False,
) -> dict[str, Any]:
    """
    Parse a plain-text SOP document into a validated SopDag dict.

    Steps:
      1. Send sop_text to the LLM with a structured prompt.
      2. Extract and parse JSON from the response.
      3. Validate the DAG structure (mirrors Zod SopDagSchema).
      4. If validation fails, ask the LLM to repair — up to max_retries times.
      5. Unless skip_review=True, show the DAG tree and wait for human approval.

    Parameters
    ----------
    sop_text    : raw text of the SOP document
    max_retries : how many LLM repair passes to attempt on validation failure
    skip_review : if True, skip the interactive human review step (for CI)

    Returns
    -------
    Validated SopDag dict, ready to be passed to push_dag_to_engine().

    Raises
    ------
    SopValidationError  — if DAG is still invalid after max_retries
    RuntimeError        — if human reviewer rejects the DAG
    EnvironmentError    — if no LLM API key is configured
    """
    print("[SOP Parser] Sending SOP to LLM for DAG generation...")
    raw = _call_llm(sop_text)

    dag = _extract_json(raw)

    # Validation + repair loop
    for attempt in range(max_retries + 1):
        try:
            _validate_dag(dag)
            break
        except SopValidationError as exc:
            if attempt == max_retries:
                raise SopValidationError(
                    f"DAG still invalid after {max_retries} repair attempts: {exc}"
                ) from exc
            print(f"[SOP Parser] Validation error (attempt {attempt + 1}): {exc}")
            print("[SOP Parser] Asking LLM to repair...")
            dag = _repair_dag(dag, str(exc))

    print("[SOP Parser] DAG validated successfully.")

    if skip_review:
        return dag

    # Human review gate
    return _human_review(dag)


def push_dag_to_engine(
    dag: dict[str, Any],
    engine_url: str | None = None,
) -> dict[str, Any]:
    """
    POST the validated DAG to sop-engine's /api/sop/templates endpoint.

    Parameters
    ----------
    dag         : validated SopDag dict from parse_sop()
    engine_url  : base URL of sop-engine, default http://localhost:3000
                  (override with env var SOP_ENGINE_URL)

    Returns
    -------
    Response JSON from the engine, e.g. {"status": "saved", "id": "SOP-..."}.

    Raises
    ------
    requests.HTTPError — if the engine returns a non-2xx status
    """
    base = (
        engine_url
        or os.environ.get("SOP_ENGINE_URL", "http://localhost:3000")
    ).rstrip("/")

    url = f"{base}/api/sop/templates"
    print(f"[SOP Parser] Pushing DAG to {url} ...")

    resp = requests.post(url, json=dag, timeout=10)
    if not resp.ok:
        print(f"[SOP Parser] Engine error {resp.status_code}: {resp.text}")
    resp.raise_for_status()

    result = resp.json()
    print(f"[SOP Parser] Engine response: {result}")
    return result


# ─────────────────────────────────────────────────────────────────
# CLI entry-point
# ─────────────────────────────────────────────────────────────────
# Run directly:
#   python sop_parser.py my_sop.txt
#   python sop_parser.py my_sop.txt --push
#   python sop_parser.py my_sop.txt --skip-review --push
#   python sop_parser.py my_sop.txt --out dag.json

if __name__ == "__main__":
    import argparse
    import pathlib
    import sys

    ap = argparse.ArgumentParser(
        description="Parse a plain-text SOP into a structured JSON DAG."
    )
    ap.add_argument("sop_file", help="Path to the plain-text SOP document")
    ap.add_argument(
        "--push",
        action="store_true",
        help="Push the approved DAG to sop-engine after review",
    )
    ap.add_argument(
        "--skip-review",
        action="store_true",
        help="Skip the interactive human review step",
    )
    ap.add_argument(
        "--out",
        metavar="FILE",
        help="Write the final DAG JSON to FILE instead of (or in addition to) pushing",
    )
    ap.add_argument(
        "--engine-url",
        default=None,
        help="sop-engine base URL (default: http://localhost:3000)",
    )
    args = ap.parse_args()

    sop_path = pathlib.Path(args.sop_file)
    if not sop_path.exists():
        print(f"Error: {sop_path} does not exist.", file=sys.stderr)
        sys.exit(1)

    sop_text = sop_path.read_text(encoding="utf-8")

    try:
        dag = parse_sop(sop_text, skip_review=args.skip_review)
    except (SopValidationError, RuntimeError) as exc:
        print(f"\n[SOP Parser] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.out:
        out_path = pathlib.Path(args.out)
        out_path.write_text(json.dumps(dag, indent=2), encoding="utf-8")
        print(f"[SOP Parser] DAG written to {out_path}")

    if args.push:
        push_dag_to_engine(dag, engine_url=args.engine_url)
    else:
        if not args.out:
            print("\n[SOP Parser] Final DAG (use --push to send to engine):\n")
            print(json.dumps(dag, indent=2))
