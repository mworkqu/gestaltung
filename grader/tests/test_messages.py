"""Message catalogue: bilingual, help slugs, Western digits."""

import re

import pytest

from app import messages as msg

CODES = ["E_NOT_STEP", "E_EMPTY", "E_PARSE_FAILED", "E_INVALID_GEOMETRY", "E_TIMEOUT", "E_MULTIPLE_SOLIDS",
         "E_NO_SOLID", "E_WRONG_UNITS", "E_TOO_LARGE", "E_NO_FILE", "E_DOWNLOAD_FAILED"]


@pytest.mark.parametrize("code", CODES)
def test_every_code_has_en_ar_and_slug(code):
    en, ar = msg.error_message(code, n=3, expected=1, direction="too_big", length_factor=1000)
    assert en and ar and en != ar
    assert re.search(r"[؀-ۿ]", ar)
    assert msg.help_slug(code)


def test_help_slug_mapping_matches_site():
    for code in ["E_NOT_STEP", "E_EMPTY", "E_PARSE_FAILED", "E_INVALID_GEOMETRY", "E_TIMEOUT", "E_MULTIPLE_SOLIDS",
                 "E_NO_SOLID"]:
        assert msg.help_slug(code) == "my-file-was-rejected"
    assert msg.help_slug("E_WRONG_UNITS") == "set-units-to-mm"
    assert msg.help_slug("E_TOO_LARGE") == "my-file-is-too-large"
    assert msg.help_slug(None) is None


def test_all_templates_bilingual_and_western_digits():
    for key, tpl in msg.MESSAGES.items():
        assert set(tpl) == {"en", "ar"}, key
        assert not re.search(r"[٠-٩]", tpl["ar"]), key  # no Arabic-Indic digits


def test_units_message_names_the_scale():
    en, ar = msg.error_message("E_WRONG_UNITS", direction="too_big", length_factor=1000)
    assert "1000 times too big" in en and "metres" in en
    assert "1000" in ar and "متر" in ar


def test_fmt_pct():
    assert msg.fmt_pct(-0.0147) == "1.5"
    assert msg.fmt_pct(0.0001) == "0.1"
    assert msg.fmt_pct(0.25) == "25"
