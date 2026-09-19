"""The YAML source is the grounding path that matters most: it addresses the
site's own data file, so a claim's source_ref points at a line a human can open.
These tests pin the parts that silently produce *wrong* facts if they regress."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from deck2short.from_yaml import chart_from, load, strip_markup

YAML = Path(__file__).parent.parent / "examples" / "site" / "resume.yaml"


def ex():
    return load(YAML)


def test_emphasised_figures_become_addressable_facts():
    f = ex().facts["experience.0.lead.2#0"]
    assert f.kind == "number" and f.value == 4.6 and f.unit == "multiple"


def test_signal_values_parse():
    f = ex().facts["profile.signals.1.value"]
    assert f.value == 100_000_000


def test_dates_do_not_become_numbers():
    """'2022-05' must never be filed as the figure 2022."""
    facts = ex().facts
    for ref in ("experience.0.start", "experience.1.end"):
        assert facts[ref].kind == "text", f"{ref} became a number"


def test_identifiers_do_not_become_numbers():
    """A patent number and a handle contain digits but assert nothing."""
    facts = ex().facts
    assert facts["research.notes.1.meta"].kind == "text"
    assert facts["links.1.handle"].kind == "text"


def test_prose_containing_a_year_stays_text():
    assert ex().facts["profile.summary"].kind == "text"


def test_markup_is_stripped_not_spoken():
    assert strip_markup("reduced evaluation time by **4.6x**") == "reduced evaluation time by 4.6x"
    assert strip_markup("[GitHub](https://x.com)") == "GitHub"


def test_chart_is_assembled_from_existing_facts():
    e = ex()
    c = chart_from(e, [("a", "experience.3.lead.1#1"), ("b", "experience.3.lead.2#1")], "t")
    assert c.values == [45.0, 40.0]


def test_chart_refuses_a_ref_that_is_not_numeric():
    import pytest

    with pytest.raises(KeyError):
        chart_from(ex(), [("a", "profile.summary")], "t")
