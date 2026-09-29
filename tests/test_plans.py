"""Saved route plans: validation, save/replace/list/delete, and ids that can't point anywhere else."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import plans  # noqa: E402

PLAN = {"name": "Seaside loop", "points": [[60.1, 24.9], [60.11, 24.92]],
        "segments": [{"points": [[60.1, 24.9, 10.0], [60.105, 24.91, 12.0], [60.11, 24.92, 11.0]]}],
        "distance": 1600.4, "climb": 2.0}


def test_valid_plan_and_errors():
    assert plans.validate(PLAN) == {}
    assert "name" in plans.validate({**PLAN, "name": " "})
    assert "points" in plans.validate({**PLAN, "points": [[60.1, 24.9]]})
    assert "segments" in plans.validate({**PLAN, "segments": []}), "one segment per pair of points"
    assert "points" in plans.validate({**PLAN, "points": [[95, 24.9], [60.1, 24.9]]})
    assert "distance" in plans.validate({**PLAN, "distance": -1})


def test_save_replace_list_delete(tmp_path):
    first = plans.save(PLAN, tmp_path)
    assert plans.ID.match(first["id"])
    assert plans.load(first["id"], tmp_path)["segments"][0]["points"][1] == [60.105, 24.91, 12.0]
    renamed = plans.save({**PLAN, "id": first["id"], "name": "Seaside loop, long"}, tmp_path)
    assert renamed["created"] == first["created"]
    other = plans.save({**PLAN, "name": "Hill repeats"}, tmp_path)
    names = [p["name"] for p in plans.summaries(tmp_path)]
    assert sorted(names) == ["Hill repeats", "Seaside loop, long"]
    assert set(plans.summaries(tmp_path)[0]) == {"id", "name", "distance", "climb", "updated", "garmin_course"}, "the list has no coordinates"
    plans.delete(other["id"], tmp_path)
    assert [p["name"] for p in plans.summaries(tmp_path)] == ["Seaside loop, long"]


@pytest.mark.parametrize("bad", ["../settings", "..\\x", "ABCDEF123456", "123", None, 5])
def test_ids_from_outside_are_refused(tmp_path, bad):
    with pytest.raises(plans.PlanError):
        plans.load(bad, tmp_path)
    with pytest.raises(plans.PlanError):
        plans.delete(bad, tmp_path)
    with pytest.raises(plans.PlanError):
        plans.save({**PLAN, "id": "0123456789ab"}, tmp_path)   # well-formed but not saved here
