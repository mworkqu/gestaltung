"""Bilingual (en + ar) feedback catalogue for the STEP grader.

Rules:
- Guide the student without revealing the answer: never put reference values
  (expected volume, area, moments, sizes) into a message. A relative
  difference ("2.1 % lower") is allowed, as in the plan.
- Arabic is natural Modern Standard Arabic, second person, short sentences.
  Digits are always Western (0-9).
- Every error code carries a Help Center slug (same mapping as
  lib/cad-champions/grader/error-codes.ts on the site).
"""

from __future__ import annotations

REJECTED = "my-file-was-rejected"

HELP_SLUGS: dict[str, str] = {
    "E_NOT_STEP": REJECTED,
    "E_EMPTY": REJECTED,
    "E_PARSE_FAILED": REJECTED,
    "E_INVALID_GEOMETRY": REJECTED,
    "E_TIMEOUT": REJECTED,
    "E_MULTIPLE_SOLIDS": REJECTED,
    "E_NO_SOLID": REJECTED,
    "E_WRONG_UNITS": "set-units-to-mm",
    "E_TOO_LARGE": "my-file-is-too-large",
    # Grader-side extras (not student mistakes in the file itself):
    "E_NO_FILE": REJECTED,
    "E_DOWNLOAD_FAILED": REJECTED,
}

# key -> {"en": template, "ar": template}; templates use str.format fields.
MESSAGES: dict[str, dict[str, str]] = {
    # ---- results -------------------------------------------------------
    "all_pass": {
        "en": "Excellent - your model matches the expected geometry.",
        "ar": "ممتاز! نموذجك يطابق الشكل المطلوب.",
    },
    "volume_low": {
        "en": "Your part's volume is {pct}% lower than expected. Check hole diameters, pocket depths and wall thicknesses.",
        "ar": "حجم قطعتك أقل من المتوقع بنسبة {pct}%. راجع أقطار الثقوب وأعماق التجاويف وسماكة الجدران.",
    },
    "volume_high": {
        "en": "Your part's volume is {pct}% higher than expected. Check hole diameters, pocket depths and wall thicknesses.",
        "ar": "حجم قطعتك أكبر من المتوقع بنسبة {pct}%. راجع أقطار الثقوب وأعماق التجاويف وسماكة الجدران.",
    },
    "area_off": {
        "en": "The volume is right but the surface area is not - check fillets, chamfers and small features.",
        "ar": "الحجم صحيح لكن مساحة السطح ليست كذلك. راجع التقويسات والشطفات والتفاصيل الصغيرة.",
    },
    "inertia_off": {
        "en": "The amount of material is right, but some features seem to be in the wrong place - check positions of holes and cut-outs.",
        "ar": "كمية المادة صحيحة، لكن يبدو أن بعض التفاصيل في غير مكانها. راجع مواضع الثقوب والفتحات.",
    },
    "solid_count_wrong": {
        "en": "Your file does not contain the expected number of bodies. Check that every part is a single closed solid.",
        "ar": "ملفك لا يحتوي على العدد المتوقع من الأجسام. تأكد أن كل قطعة جسم صلب واحد مغلق.",
    },
    "practice_passed": {
        "en": "Practice check passed.",
        "ar": "اجتزت فحص التمرين.",
    },
    "practice_failed": {
        "en": "Practice check not passed yet - read the hints and try again.",
        "ar": "لم تجتز فحص التمرين بعد. اقرأ التلميحات وحاول مرة أخرى.",
    },
    # ---- assembly ------------------------------------------------------
    "asm_all_pass": {
        "en": "Excellent - every part is correct and in the right place.",
        "ar": "ممتاز! كل القطع صحيحة وفي مكانها الصحيح.",
    },
    "asm_missing": {
        "en": "Some parts are missing from your assembly: {names}. Add them and export again.",
        "ar": "بعض القطع غير موجودة في تجميعتك: {names}. أضفها ثم صدّر مرة أخرى.",
    },
    "asm_extra": {
        "en": "Your assembly has {n} extra body(ies) that we could not match to any expected part. Remove extra or duplicated bodies.",
        "ar": "في تجميعتك أجسام زائدة لم نجد لها قطعة مطابقة، وعددها {n}. احذف الأجسام الزائدة أو المكررة.",
    },
    "asm_parts_wrong": {
        "en": "These parts do not match the expected geometry: {names}. Check their sizes and features.",
        "ar": "هذه القطع لا تطابق الشكل المطلوب: {names}. راجع مقاساتها وتفاصيلها.",
    },
    "asm_positions": {
        "en": "All parts are correct, but their positions don't match - check your constraints.",
        "ar": "كل القطع صحيحة، لكن مواضعها لا تطابق المطلوب. راجع قيود التجميع (Constraints).",
    },
    # ---- package -------------------------------------------------------
    "matched_by_volume": {
        "en": "We could not find a file named as this task asks, so we matched {file} by its size. Name your files exactly as the task says.",
        "ar": "لم نجد ملفًا بالاسم الذي تطلبه هذه المهمة، فطابقنا الملف {file} حسب حجمه. سمِّ ملفاتك كما تطلب المهمة تمامًا.",
    },
    # ---- error codes ---------------------------------------------------
    "E_NOT_STEP": {
        "en": "This file is not a STEP file. Export your model again as STEP (AP214 or AP242) and make sure the file name ends in .step or .stp.",
        "ar": "هذا الملف ليس ملف STEP. صدّر نموذجك مرة أخرى بصيغة STEP (AP214 أو AP242) وتأكد أن اسم الملف ينتهي بـ .step أو .stp.",
    },
    "E_EMPTY": {
        "en": "The file is empty, so there is nothing to grade. Export your model again and check that the file is not 0 KB before you upload.",
        "ar": "الملف فارغ، فلا يوجد شيء لنقيّمه. صدّر نموذجك مرة أخرى وتأكد أن حجم الملف ليس 0 KB قبل الرفع.",
    },
    "E_PARSE_FAILED": {
        "en": "We could not read this file. It may be damaged or cut short. Export it again as STEP and upload the new file.",
        "ar": "لم نتمكن من قراءة هذا الملف. ربما هو تالف أو لم يكتمل تصديره. صدّره مرة أخرى بصيغة STEP وارفع الملف الجديد.",
    },
    "E_TIMEOUT": {
        "en": "Checking your file took too long, so we stopped. Try again in a minute. If it keeps happening, simplify the model and export again.",
        "ar": "استغرق فحص ملفك وقتًا طويلًا فتوقفنا. حاول مرة أخرى بعد دقيقة. وإن تكرر ذلك، بسّط النموذج وصدّره مرة أخرى.",
    },
    "E_NO_SOLID": {
        "en": "We found no solid body in your file. It may contain only sketches or surfaces. Turn your design into a solid body and export again.",
        "ar": "لم نجد أي جسم صلب في ملفك. ربما يحتوي على رسومات أو أسطح فقط. حوّل تصميمك إلى جسم صلب ثم صدّر مرة أخرى.",
    },
    "E_MULTIPLE_SOLIDS": {
        "en": "Your file contains {n} separate bodies; this task expects {expected}. Combine them before exporting.",
        "ar": "ملفك يحتوي على {n} أجسام منفصلة، وهذه المهمة تتوقع {expected_ar}. ادمجها قبل التصدير.",
    },
    "E_WRONG_UNITS_big": {
        "en": "Your model looks about {factor} times too big - it was probably exported in the wrong units ({hint}). Set units to mm and export again.",
        "ar": "يبدو نموذجك أكبر من المطلوب بحوالي {factor} مرة، وغالبًا صُدّر بوحدات خاطئة ({hint_ar}). اضبط الوحدات على المليمتر ثم صدّر مرة أخرى.",
    },
    "E_WRONG_UNITS_small": {
        "en": "Your model looks about {factor} times too small - it was probably exported in the wrong units ({hint}). Set units to mm and export again.",
        "ar": "يبدو نموذجك أصغر من المطلوب بحوالي {factor} مرة، وغالبًا صُدّر بوحدات خاطئة ({hint_ar}). اضبط الوحدات على المليمتر ثم صدّر مرة أخرى.",
    },
    "E_INVALID_GEOMETRY": {
        "en": "The shape in your file has a geometry problem (for example faces that do not close properly). We still checked it, but fix the errors in your model and export again.",
        "ar": "في شكل نموذجك مشكلة هندسية (مثلًا أسطح لا تُغلق بشكل صحيح). فحصناه رغم ذلك، لكن أصلح الأخطاء في نموذجك ثم صدّره مرة أخرى.",
    },
    "E_TOO_LARGE": {
        "en": "This file is too large to check (over {max_mb} MB). Export only the required part and try again.",
        "ar": "هذا الملف أكبر من أن نفحصه (أكثر من {max_mb} MB). صدّر الجزء المطلوب فقط ثم حاول مرة أخرى.",
    },
    "E_NO_FILE": {
        "en": "We found no STEP file for this task. Export the part as STEP, name it as the task asks, and put it in the Parts and Assemblies folder.",
        "ar": "لم نجد ملف STEP لهذه المهمة. صدّر القطعة بصيغة STEP وسمِّها كما تطلب المهمة وضعها في مجلد Parts and Assemblies.",
    },
    "E_DOWNLOAD_FAILED": {
        "en": "We could not fetch your file for checking. No action needed - we will check it again or manually.",
        "ar": "لم نتمكن من جلب ملفك لفحصه. لا تحتاج لفعل شيء، سنعيد فحصه أو نفحصه يدويًا.",
    },
}

# Hints for E_WRONG_UNITS, by the linear scale factor that was detected.
UNIT_HINTS: dict[str, tuple[str, str]] = {
    "10": ("centimetres vs millimetres", "سنتيمتر بدل مليمتر"),
    "100": ("decimetres vs millimetres", "ديسيمتر بدل مليمتر"),
    "1000": ("metres vs millimetres", "متر بدل مليمتر"),
    "25.4": ("inches vs millimetres", "إنش بدل مليمتر"),
}

_AR_COUNT = {1: "جسمًا واحدًا", 2: "جسمين"}


def render(key: str, **params) -> tuple[str, str]:
    """(en, ar) for a message key. Unknown keys fall back to a generic line."""
    tpl = MESSAGES.get(key)
    if tpl is None:
        return (
            "We could not check this file. Check that it is a STEP file of the right part, then try again.",
            "لم نتمكن من فحص هذا الملف. تأكد أنه ملف STEP للقطعة الصحيحة ثم حاول مرة أخرى.",
        )
    return tpl["en"].format(**params), tpl["ar"].format(**params)


def help_slug(code: str | None) -> str | None:
    if not code:
        return None
    return HELP_SLUGS.get(code, REJECTED)


def fmt_pct(fraction: float) -> str:
    """0.0147 -> '1.5' (Western digits, at least 0.1)."""
    pct = abs(fraction) * 100.0
    if pct >= 10:
        return f"{pct:.0f}"
    return f"{max(pct, 0.1):.1f}"


def fmt_factor(factor: float) -> str:
    return "25.4" if abs(factor - 25.4) < 1e-6 else f"{factor:g}"


def error_message(code: str, **params) -> tuple[str, str]:
    """Message for an error code, filling the parameters it needs."""
    if code == "E_MULTIPLE_SOLIDS":
        n = int(params.get("n", 2))
        expected = int(params.get("expected", 1))
        return render(code, n=n, expected=expected, expected_ar=_AR_COUNT.get(expected, f"{expected} أجسام"))
    if code == "E_WRONG_UNITS":
        factor = fmt_factor(float(params.get("length_factor", 1000)))
        hint, hint_ar = UNIT_HINTS.get(factor, ("wrong unit setting", "إعداد وحدات خاطئ"))
        key = "E_WRONG_UNITS_big" if params.get("direction") == "too_big" else "E_WRONG_UNITS_small"
        return render(key, factor=factor, hint=hint, hint_ar=hint_ar)
    if code == "E_TOO_LARGE":
        return render(code, max_mb=params.get("max_mb", 50))
    return render(code)


def join(lines: list[tuple[str, str]]) -> tuple[str, str]:
    """Concatenate several (en, ar) messages into one paragraph each."""
    en = " ".join(m[0] for m in lines if m[0])
    ar = " ".join(m[1] for m in lines if m[1])
    return en, ar
