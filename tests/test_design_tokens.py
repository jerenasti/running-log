"""The design system (css/tokens.css) keeps its promises: WCAG AA contrast in both themes,
and the two dark-theme blocks stay identical."""

import re
from pathlib import Path

import pytest

CSS = (Path(__file__).parent.parent / "css" / "tokens.css").read_text(encoding="utf-8")


def block(start: str) -> dict:
    """Hex colors defined in the rule that starts with `start`"""
    i = CSS.index(start)
    body = CSS[CSS.index("{", i + len(start) - 1) + 1: CSS.index("}", i)]
    return dict(re.findall(r"(--[\w-]+):\s*(#[0-9A-Fa-f]{6})\b", body))


LIGHT = block(":root {")
DARK_SYSTEM = block(':root:not([data-theme="light"]) {')
DARK_FORCED = block(':root[data-theme="dark"] {')
THEMES = {"light": LIGHT, "dark": {**LIGHT, **DARK_FORCED}}


def luminance(hex_color: str) -> float:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


SURFACES = ["--bg", "--surface", "--surface-2"]
TEXT = ["--text", "--text-2", "--text-3", "--accent-text",
        "--status-under-text", "--status-ok-text", "--status-watch-text", "--status-warn-text"]
FILLS = ["--accent", "--status-under", "--status-ok", "--status-watch", "--status-warn", "--border-control"]


def test_dark_blocks_are_identical():
    assert DARK_SYSTEM == DARK_FORCED


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg", TEXT)
def test_text_meets_wcag_aa(theme, fg):
    t = THEMES[theme]
    for bg in SURFACES:
        assert contrast(t[fg], t[bg]) >= 4.5, f"{theme}: {fg} on {bg} is {contrast(t[fg], t[bg]):.2f}"


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fill", FILLS)
def test_fills_and_controls_meet_non_text_contrast(theme, fill):
    t = THEMES[theme]
    for bg in SURFACES:
        assert contrast(t[fill], t[bg]) >= 3, f"{theme}: {fill} on {bg} is {contrast(t[fill], t[bg]):.2f}"


@pytest.mark.parametrize("theme", THEMES)
def test_chart_tooltips_are_readable(theme):
    t = THEMES[theme]
    assert contrast(t["--chart-tooltip-text"], t["--chart-tooltip-bg"]) >= 7
    assert contrast(t["--chart-tooltip-muted"], t["--chart-tooltip-bg"]) >= 4.5
    assert contrast(t["--on-accent"], t["--accent"]) >= 3, "large text on the accent"
