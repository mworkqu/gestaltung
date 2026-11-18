"""Build reference_data JSON from the answer STEP file.

    python tools/make_reference.py answer.step --density 7850
    python tools/make_reference.py assembly.step --density 7850 --assembly part_names.json

part_names.json is a JSON list of names in the order the solids appear in the
file (or {"parts": [...]}). Prints the reference_data JSON to stdout.
Needs cadquery installed (run it inside the grader image or a venv with cadquery).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import compare, measure  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", help="answer STEP file")
    ap.add_argument("--density", type=float, default=7850.0, help="kg/m3 (steel 7850, aluminium 2700)")
    ap.add_argument("--assembly", help="JSON file with the part names in solid order")
    args = ap.parse_args(argv)

    names = None
    if args.assembly:
        raw = json.loads(Path(args.assembly).read_text(encoding="utf-8"))
        names = raw.get("parts") if isinstance(raw, dict) else raw
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            print("part_names.json must be a list of strings", file=sys.stderr)
            return 2
    try:
        m = measure.measure_source(file_path=args.step)
    except measure.GraderError as exc:
        print(f"{exc.code}: {exc.params}", file=sys.stderr)
        return 1
    if m.get("solids", 0) == 0:
        print("E_NO_SOLID: the file has no solid body", file=sys.stderr)
        return 1
    try:
        ref = compare.reference_from_measurement(m, args.density, names)
    except compare.BadReference as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not m.get("valid", True):
        print("warning: E_INVALID_GEOMETRY - the answer file has invalid geometry", file=sys.stderr)
    print(json.dumps(ref, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
