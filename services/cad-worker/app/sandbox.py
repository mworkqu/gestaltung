"""Static checks on AI-written CadQuery code, before anything runs it.

Layer 1 of the sandbox (see README.md). Pure: no cadquery import, no I/O, so
the tests run on any Python and the runner can re-check inside the child.

The code may import only `cadquery`, `math` and our `cadhelpers`, must assign
the final shape to `result`, and may not touch anything that reaches outside
the model: no eval/exec/open/getattr..., no dunder names or attributes, no
private (`_x`) attributes, no frame/code introspection attributes, no
cadquery file I/O or code-running submodules.
"""

from __future__ import annotations

import ast

MAX_SOURCE_BYTES = 20_000
MAX_AST_NODES = 8_000

ALLOWED_MODULES = frozenset({"cadquery", "math", "cadhelpers"})

# Builtins and names that execute code, read/write files, or reach objects'
# internals. Banned as a bare name AND as an attribute (`cq.os`, `x.eval`).
BANNED_NAMES = frozenset(
    {
        # code execution / introspection
        "exec", "eval", "compile", "open", "input", "__import__", "globals",
        "locals", "vars", "getattr", "setattr", "delattr", "breakpoint",
        "type", "object", "super", "dir", "help", "exit", "quit",
        "memoryview", "classmethod", "staticmethod", "property",
        # modules that reach the OS, network, interpreter or serialisation
        "os", "sys", "subprocess", "socket", "pathlib", "importlib", "shutil",
        "builtins", "ctypes", "io", "pickle", "marshal",
    }
)

# Attributes that would reach cadquery's file I/O, its own code runner, the
# raw OpenCascade bindings, or string formatting (which can read attributes
# by name, bypassing these checks).
BANNED_ATTRIBUTES = frozenset(
    {
        "cqgi", "occ_impl", "OCP", "exporters", "importers", "vis", "cq_directive",
        "save", "format", "format_map", "mro",
    }
)
# Attribute prefixes: file I/O methods (exportStl, importStep, ...) and
# frame / code / generator internals (f_back, f_globals, gi_frame, tb_frame...).
BANNED_ATTRIBUTE_PREFIXES = (
    "export", "import", "f_", "gi_", "cr_", "ag_", "tb_", "co_", "func_", "im_",
)

# Statement / expression types the model never needs.
BANNED_NODES: dict[type, str] = {
    ast.ClassDef: "class definitions",
    ast.AsyncFunctionDef: "async functions",
    ast.Await: "await",
    ast.AsyncFor: "async for",
    ast.AsyncWith: "async with",
    ast.With: "with blocks",
    ast.Global: "global statements",
    ast.Nonlocal: "nonlocal statements",
}


class Rejected(Exception):
    """The code may not run. `str(exc)` is a plain-English reason."""


def _is_dunder(name: str) -> bool:
    return name.startswith("__")


def _check_attribute(attr: str, line: int) -> None:
    if _is_dunder(attr):
        raise Rejected(f"Line {line}: names starting with \"__\" (like .{attr}) are not allowed.")
    if attr.startswith("_"):
        raise Rejected(f"Line {line}: private attributes (like .{attr}) are not allowed.")
    if attr in BANNED_NAMES:
        raise Rejected(f"Line {line}: \"{attr}\" is not allowed in model code.")
    if attr in BANNED_ATTRIBUTES:
        raise Rejected(f"Line {line}: \".{attr}\" is not allowed in model code.")
    lowered = attr.lower()
    for prefix in BANNED_ATTRIBUTE_PREFIXES:
        if lowered.startswith(prefix):
            raise Rejected(
                f"Line {line}: \".{attr}\" is not allowed — the worker saves the files itself, "
                "and model code may not read or write anything."
            )


def _check_name(name: str, line: int) -> None:
    if _is_dunder(name):
        raise Rejected(f"Line {line}: names starting with \"__\" (like {name}) are not allowed.")
    if name in BANNED_NAMES:
        raise Rejected(f"Line {line}: \"{name}\" is not allowed in model code.")


def _check_import_module(module: str | None, line: int) -> None:
    if module not in ALLOWED_MODULES:
        raise Rejected(
            f"Line {line}: importing \"{module}\" is not allowed. "
            "Only cadquery, math and cadhelpers can be imported."
        )


def validate(code: str) -> ast.Module:
    """Parse and check the code. Returns the AST, or raises Rejected."""
    if not isinstance(code, str) or not code.strip():
        raise Rejected("The model code is empty.")
    size = len(code.encode("utf-8"))
    if size > MAX_SOURCE_BYTES:
        raise Rejected(f"The model code is {size} bytes; keep it under {MAX_SOURCE_BYTES}.")
    if "\x00" in code:
        raise Rejected("The model code contains a null byte.")

    try:
        tree = ast.parse(code, filename="<model>", mode="exec")
    except SyntaxError as exc:
        raise Rejected(f"The code has a syntax error on line {exc.lineno}: {exc.msg}.") from None
    except (ValueError, RecursionError, MemoryError):
        raise Rejected("The model code could not be read (it is malformed or too deeply nested).") from None

    count = 0
    for node in ast.walk(tree):
        count += 1
        if count > MAX_AST_NODES:
            raise Rejected(f"The model code is too long or complex (over {MAX_AST_NODES} syntax nodes).")
        line = getattr(node, "lineno", 0)

        for banned_type, label in BANNED_NODES.items():
            if isinstance(node, banned_type):
                raise Rejected(f"Line {line}: {label} are not allowed in model code.")

        if isinstance(node, ast.Import):
            for alias in node.names:
                _check_import_module(alias.name, line)
                if alias.asname:
                    _check_name(alias.asname, line)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise Rejected(f"Line {line}: relative imports are not allowed.")
            _check_import_module(node.module, line)
            for alias in node.names:
                if alias.name == "*":
                    raise Rejected(f"Line {line}: \"import *\" is not allowed; import names one by one.")
                _check_attribute(alias.name, line)
                if alias.asname:
                    _check_name(alias.asname, line)
        elif isinstance(node, ast.Name):
            _check_name(node.id, line)
        elif isinstance(node, ast.Attribute):
            _check_attribute(node.attr, line)
        elif isinstance(node, (ast.FunctionDef, ast.Lambda)):
            if isinstance(node, ast.FunctionDef):
                _check_name(node.name, line)
            args = node.args
            for a in [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]:
                if a is not None:
                    _check_name(a.arg, line)
        elif isinstance(node, ast.keyword):
            if node.arg is not None:
                _check_name(node.arg, line)
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                _check_name(node.name, line)
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)):
            if node.name:
                _check_name(node.name, line)

    if not _assigns_result(tree):
        raise Rejected(
            "The code never assigns the final shape to a variable named `result` "
            "(for example: result = body)."
        )
    return tree


def _assigns_result(tree: ast.Module) -> bool:
    for node in tree.body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            targets = [node.target]
        for t in targets:
            if isinstance(t, ast.Name) and t.id == "result":
                return True
    return False


def check(code: str) -> str | None:
    """None when the code may run, else the plain-English reason."""
    try:
        validate(code)
    except Rejected as exc:
        return str(exc)
    return None
