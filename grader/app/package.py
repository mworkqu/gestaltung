"""Match the STEP files of a module package (ZIP of the Results folder) to tasks.

1. By the task's expected name patterns (package_expectations), e.g.
   "Parts and Assemblies/Part_03.*" (glob, case-insensitive, matched against the
   end of the path) or "re:..." (regular expression on the path).
2. Tasks still without a file get the remaining STEP file with the closest
   volume to their reference volume (Hungarian assignment). Those are flagged
   matched_by_volume so the trainer can check them.
Pure: no cadquery, no I/O.
"""

from __future__ import annotations

import fnmatch
import math
import re
from dataclasses import dataclass, field

STEP_EXTS = (".step", ".stp")
VOLUME_MATCH_MAX = 0.25  # closest-volume fallback only within 25 %


def normalise(name: str) -> str:
    n = name.replace("\\", "/").strip()
    while n.startswith("./"):
        n = n[2:]
    return n.lstrip("/").lower()


def is_step_name(name: str) -> bool:
    return normalise(name).endswith(STEP_EXTS)


def pattern_matches(pattern: str, name: str) -> bool:
    path = normalise(name)
    base = path.rsplit("/", 1)[-1]
    if pattern.startswith("re:"):
        try:
            rx = re.compile(pattern[3:], re.IGNORECASE)
        except re.error:
            return False
        return bool(rx.search(path))
    pat = normalise(pattern)
    if "/" in pat:
        return fnmatch.fnmatchcase(path, pat) or fnmatch.fnmatchcase(path, "*/" + pat)
    return fnmatch.fnmatchcase(base, pat)


@dataclass
class TaskSpec:
    task_id: str
    patterns: list[str]
    reference_volume: float | None = None


@dataclass
class Assignment:
    task_id: str
    file: str | None
    matched_by: str | None  # "name" | "volume" | None
    ambiguous: list[str] = field(default_factory=list)  # other files that also matched the name

    @property
    def matched_by_volume(self) -> bool:
        return self.matched_by == "volume"


@dataclass
class PackageMatch:
    assignments: dict[str, Assignment]
    unmatched_files: list[str]
    ignored_files: list[str]  # not STEP (native CAD, PDFs, renders...) — listed for the trainer


def match_by_name(step_files: list[str], tasks: list[TaskSpec]) -> tuple[dict[str, Assignment], list[str]]:
    used: set[str] = set()
    out: dict[str, Assignment] = {}
    for t in tasks:
        candidates = sorted(
            (f for f in step_files if f not in used and any(pattern_matches(p, f) for p in t.patterns)),
            key=lambda f: (len(normalise(f)), normalise(f)),
        )
        if candidates:
            used.add(candidates[0])
            out[t.task_id] = Assignment(t.task_id, candidates[0], "name", ambiguous=candidates[1:])
        else:
            out[t.task_id] = Assignment(t.task_id, None, None)
    remaining = [f for f in step_files if f not in used]
    return out, remaining


def match_by_volume(tasks: list[TaskSpec], files: list[str], volumes: dict[str, float | None],
                    max_rel: float = VOLUME_MATCH_MAX) -> dict[str, str]:
    """task_id -> file, for tasks with a reference volume and files with a measured volume."""
    ts = [t for t in tasks if t.reference_volume and t.reference_volume > 0]
    fs = [f for f in files if volumes.get(f) and volumes[f] > 0]
    if not ts or not fs:
        return {}
    from scipy.optimize import linear_sum_assignment

    big = 1e6
    cost = []
    for t in ts:
        row = []
        for f in fs:
            e = abs(volumes[f] - t.reference_volume) / t.reference_volume  # type: ignore[operator]
            row.append(e if math.isfinite(e) else big)
        cost.append(row)
    rows, cols = linear_sum_assignment(cost)
    return {ts[r].task_id: fs[c] for r, c in zip(rows, cols) if cost[r][c] <= max_rel}


def match_package(files: list[str], tasks: list[TaskSpec], volumes: dict[str, float | None] | None = None,
                  max_rel: float = VOLUME_MATCH_MAX) -> PackageMatch:
    step_files = [f for f in files if is_step_name(f)]
    ignored = [f for f in files if not is_step_name(f)]
    assignments, remaining = match_by_name(step_files, tasks)
    open_tasks = [t for t in tasks if assignments[t.task_id].file is None]
    if open_tasks and remaining and volumes:
        for task_id, f in match_by_volume(open_tasks, remaining, volumes, max_rel).items():
            assignments[task_id] = Assignment(task_id, f, "volume")
            remaining.remove(f)
    return PackageMatch(assignments=assignments, unmatched_files=remaining, ignored_files=ignored)
