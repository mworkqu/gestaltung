"""Module package matching: name patterns first, then closest volume (flagged)."""

from app import package as pkg

FILES = [
    "A12/DAY 01/Results/Parts and Assemblies/Part_01.step",
    "A12/DAY 01/Results/Parts and Assemblies/part_02.STP",
    "A12/DAY 01/Results/Parts and Assemblies/Part_03.ipt",
    "A12/DAY 01/Results/Parts and Assemblies/bracket final v2.step",
    "A12/DAY 01/Results/PDF files/drawing.pdf",
]


def tasks(vols=(1000.0, 2000.0, 3000.0)):
    return [
        pkg.TaskSpec("t1", ["Parts and Assemblies/Part_01.*"], vols[0]),
        pkg.TaskSpec("t2", ["Parts and Assemblies/Part_02.*"], vols[1]),
        pkg.TaskSpec("t3", ["Parts and Assemblies/Part_03.*"], vols[2]),
    ]


def test_pattern_rules():
    assert pkg.pattern_matches("Parts and Assemblies/Part_01.*", FILES[0])
    assert pkg.pattern_matches("part_02.st?", FILES[1])  # basename-only pattern, case-insensitive
    assert pkg.pattern_matches(r"re:part_0[12]\.(step|stp)$", FILES[1])
    assert not pkg.pattern_matches("Part_01.*", FILES[1])
    assert not pkg.pattern_matches("re:([", FILES[0])  # a bad regex never crashes


def test_name_match_then_volume_fallback_flagged():
    volumes = {FILES[0]: 1000.0, FILES[1]: 2010.0, FILES[3]: 2990.0}
    m = pkg.match_package(FILES, tasks(), volumes)
    a = m.assignments
    assert a["t1"].file == FILES[0] and a["t1"].matched_by == "name"
    assert a["t2"].file == FILES[1] and not a["t2"].matched_by_volume
    # only the native .ipt matches Part_03 by name -> closest-volume STEP file, flagged
    assert a["t3"].file == FILES[3] and a["t3"].matched_by_volume
    assert m.unmatched_files == []
    assert FILES[2] in m.ignored_files and FILES[4] in m.ignored_files


def test_volume_fallback_needs_close_volume():
    volumes = {FILES[0]: 1000.0, FILES[1]: 2000.0, FILES[3]: 9000.0}
    m = pkg.match_package(FILES, tasks(), volumes)
    assert m.assignments["t3"].file is None
    assert m.unmatched_files == [FILES[3]]


def test_volume_fallback_uses_hungarian_assignment():
    files = ["x/a.step", "x/b.step"]
    ts = [pkg.TaskSpec("big", ["nothing.*"], 1000.0), pkg.TaskSpec("small", ["nothing.*"], 900.0)]
    # greedy would give a.step (950) to "big"; the optimal pairing is a->small, b->big
    m = pkg.match_package(files, ts, {"x/a.step": 950.0, "x/b.step": 1040.0})
    assert m.assignments["big"].file == "x/b.step"
    assert m.assignments["small"].file == "x/a.step"
    assert all(a.matched_by_volume for a in m.assignments.values())


def test_ambiguous_name_matches_reported():
    files = ["r/Part_01.step", "r/old/Part_01.step"]
    m = pkg.match_package(files, [pkg.TaskSpec("t1", ["Part_01.*"], 1.0)], {})
    assert m.assignments["t1"].file == "r/Part_01.step"
    assert m.assignments["t1"].ambiguous == ["r/old/Part_01.step"]
