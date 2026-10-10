"""Static sandbox checks. Pure: no cadquery needed."""

import pytest

from app import sandbox

GOOD = """
import cadquery as cq
import math
from cadquery import Workplane
import cadhelpers

# named dimensions
LENGTH = 80.0
WIDTH = 60.0
HEIGHT = 30.0
WALL = 2.0

def shell(l, w, h, t):
    outer = cq.Workplane("XY").box(l, w, h, centered=(True, True, False))
    return outer.faces(">Z").shell(-t)

holes = [(x, 0) for x in range(-20, 21, 20)]
r = max(map(lambda v: v * 2, [1, 2, 3]))
result = shell(LENGTH, WIDTH, HEIGHT, WALL)
"""


def ok(code: str) -> None:
    assert sandbox.check(code) is None, sandbox.check(code)


def rejected(code: str, *words: str) -> str:
    reason = sandbox.check(code)
    assert reason is not None, f"expected a rejection for: {code!r}"
    for w in words:
        assert w.lower() in reason.lower(), reason
    return reason


def test_good_model_passes():
    ok(GOOD)


@pytest.mark.parametrize(
    "line",
    [
        "import cadquery",
        "import cadquery as cq",
        "from cadquery import Workplane, Assembly",
        "import math",
        "from math import pi, sqrt",
        "import cadhelpers",
        "from cadhelpers import open_box",
        "f = lambda x: x + 1",
    ],
)
def test_allowed_imports_and_lambda(line):
    ok(line + "\nresult = 1\n")


# ---------------------------------------------------------------- imports


@pytest.mark.parametrize(
    "line",
    [
        "import os",
        "import sys",
        "import subprocess",
        "import socket",
        "import pathlib",
        "import importlib",
        "import shutil",
        "import builtins",
        "import ctypes",
        "import io",
        "import pickle",
        "import marshal",
        "import numpy",
        "import cadquery.occ_impl.shapes",
        "import OCP",
        "from os import path",
        "from cadquery.occ_impl import exporters",
        "import math, os",
    ],
)
def test_forbidden_imports(line):
    rejected(line + "\nresult = 1\n", "not allowed")


def test_relative_import():
    rejected("from . import cadhelpers\nresult = 1\n", "relative")


def test_star_import():
    rejected("from cadquery import *\nresult = 1\n", "import *")


@pytest.mark.parametrize("name", ["exporters", "importers", "cqgi", "occ_impl", "OCP", "vis"])
def test_from_cadquery_import_banned_submodule(name):
    rejected(f"from cadquery import {name}\nresult = 1\n", "not allowed")


def test_import_alias_cannot_shadow_banned_name():
    rejected("import math as os\nresult = 1\n", "not allowed")


# --------------------------------------------------------------- builtins


@pytest.mark.parametrize(
    "call",
    [
        "exec('1')",
        "eval('1')",
        "compile('1', 'x', 'exec')",
        "open('/etc/passwd')",
        "input()",
        "__import__('os')",
        "globals()",
        "locals()",
        "vars()",
        "getattr(1, 'real')",
        "setattr(x, 'a', 1)",
        "delattr(x, 'a')",
        "breakpoint()",
        "type(1)",
        "object()",
        "super()",
        "dir()",
        "help()",
        "exit()",
        "quit()",
        "memoryview(b'')",
    ],
)
def test_forbidden_builtins(call):
    rejected(f"x = 1\ny = {call}\nresult = 1\n", "not allowed")


def test_builtin_referenced_without_call():
    rejected("f = eval\nresult = 1\n", "not allowed")


# ----------------------------------------------------------- dunder & co.


@pytest.mark.parametrize(
    "code",
    [
        "x = (1).__class__\nresult = 1\n",
        "x = [].__class__.__base__.__subclasses__()\nresult = 1\n",
        "__builtins__\nresult = 1\n",
        "__name__\nresult = 1\n",
        "__x__ = 1\nresult = 1\n",
        "def f(__a): return __a\nresult = 1\n",
        "def __f(): return 1\nresult = 1\n",
        "f = lambda __a: __a\nresult = 1\n",
        "x = dict(__class__=1)\nresult = 1\n",
        "try:\n    pass\nexcept Exception as __e:\n    pass\nresult = 1\n",
        "x = f'{(1).__class__}'\nresult = 1\n",
    ],
)
def test_dunder_names_and_attributes(code):
    rejected(code, "__")


@pytest.mark.parametrize("attr", ["_private", "_geomAdaptor", "_uvBounds"])
def test_private_attributes(attr):
    rejected(f"import cadquery as cq\nx = cq.Workplane().{attr}\nresult = 1\n", "private")


@pytest.mark.parametrize("mod", ["os", "sys", "subprocess", "socket", "pathlib", "importlib", "shutil",
                                 "builtins", "ctypes", "io", "pickle", "marshal"])
def test_banned_module_names_as_attribute_or_name(mod):
    rejected(f"import cadquery as cq\nx = cq.{mod}\nresult = 1\n", "not allowed")
    rejected(f"x = {mod}\nresult = 1\n", "not allowed")


@pytest.mark.parametrize(
    "attr",
    ["cqgi", "occ_impl", "exporters", "importers", "OCP", "save", "format", "format_map", "mro",
     "exportStl", "exportStep", "exportBrep", "importStep", "importBrep", "export", "importDXF"],
)
def test_banned_attributes(attr):
    rejected(f"import cadquery as cq\nx = cq.Workplane().box(1, 1, 1).{attr}\nresult = 1\n", "not allowed")


@pytest.mark.parametrize("attr", ["gi_frame", "f_back", "f_globals", "f_locals", "f_builtins", "tb_frame",
                                  "tb_next", "co_code", "cr_frame", "ag_frame", "func_globals"])
def test_frame_and_code_introspection(attr):
    rejected(f"g = (i for i in [1])\nx = g.{attr}\nresult = 1\n", "not allowed")


def test_string_format_attribute_trick():
    rejected("x = '{0.real}'.format(1)\nresult = 1\n", "not allowed")


# --------------------------------------------------------------- statements


@pytest.mark.parametrize(
    "code,word",
    [
        ("class A:\n    pass\nresult = 1\n", "class"),
        ("async def f():\n    pass\nresult = 1\n", "async"),
        ("def f():\n    global g\n    g = 1\nresult = 1\n", "global"),
        ("def f():\n    x = 1\n    def g():\n        nonlocal x\n    return g\nresult = 1\n", "nonlocal"),
        ("with x as y:\n    pass\nresult = 1\n", "with"),
    ],
)
def test_forbidden_statements(code, word):
    rejected(code, word)


# --------------------------------------------------------------- shape of code


def test_empty_code():
    rejected("", "empty")
    rejected("   \n\t\n", "empty")


def test_source_too_large():
    code = "result = 1\n" + ("# padding\n" * 3000)
    assert len(code.encode()) > sandbox.MAX_SOURCE_BYTES
    rejected(code, "bytes")


def test_too_many_ast_nodes():
    # Under the byte limit but over the node limit.
    code = "x = [" + ",".join(["1"] * 9000) + "]\nresult = 1\n"
    assert len(code.encode()) < sandbox.MAX_SOURCE_BYTES
    rejected(code, "complex")


def test_syntax_error():
    rejected("result = (\n", "syntax error", "line")


def test_null_byte():
    rejected("result = 1\x00\n", "null")


def test_missing_result():
    rejected("import cadquery as cq\nbody = cq.Workplane().box(1, 1, 1)\n", "result")


def test_result_only_inside_function_is_missing():
    rejected("def f():\n    result = 1\n    return result\nf()\n", "result")


def test_annotated_result_counts():
    ok("result: int = 1\n")


def test_non_string_code():
    assert sandbox.check(None) is not None  # type: ignore[arg-type]


def test_reasons_are_plain_english_with_line_numbers():
    reason = rejected("x = 1\ny = 2\nimport os\nresult = 1\n")
    assert reason.startswith("Line 3:")
