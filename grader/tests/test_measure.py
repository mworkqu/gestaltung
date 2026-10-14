"""Loading, header checks and the parse-process timeout (no cadquery needed)."""

import time

import pytest

from app import measure
from tests import helpers

STEP_HEAD = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"


def test_empty_file():
    with pytest.raises(measure.GraderError) as e:
        measure.check_header(b"")
    assert e.value.code == "E_EMPTY"
    with pytest.raises(measure.GraderError) as e:
        measure.check_header(b"   \n\t")
    assert e.value.code == "E_EMPTY"


def test_pdf_renamed_step_is_not_step(tmp_path):
    f = tmp_path / "part.step"
    f.write_bytes(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n")
    m = measure.measurement_or_error(file_path=str(f))
    assert m["error_code"] == "E_NOT_STEP"


def test_bom_and_whitespace_before_header_ok():
    measure.check_header(b"\xef\xbb\xbf  \n" + STEP_HEAD)


def test_too_large(tmp_path):
    f = tmp_path / "big.step"
    f.write_bytes(STEP_HEAD + b"x" * 2048)
    with pytest.raises(measure.GraderError) as e:
        measure.load(file_path=str(f), max_bytes=1024)
    assert e.value.code == "E_TOO_LARGE"


def test_only_https_urls():
    with pytest.raises(measure.GraderError) as e:
        measure.download("http://example.com/x.step")
    assert e.value.code == "E_DOWNLOAD_FAILED"


def test_pathological_file_killed_by_timeout(monkeypatch):
    monkeypatch.setattr(measure, "_CHILD_TARGET", helpers.slow_child)
    t0 = time.monotonic()
    with pytest.raises(measure.GraderError) as e:
        measure.measure_bytes(STEP_HEAD, timeout_s=2)
    assert e.value.code == "E_TIMEOUT"
    assert time.monotonic() - t0 < 15  # killed, not waited for


def test_child_parse_error_reported(monkeypatch):
    monkeypatch.setattr(measure, "_CHILD_TARGET", helpers.crashing_child)
    with pytest.raises(measure.GraderError) as e:
        measure.measure_bytes(STEP_HEAD, timeout_s=20)
    assert e.value.code == "E_PARSE_FAILED"
