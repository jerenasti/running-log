"""Tests for backup.py. They only use temporary folders."""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import backup as bk  # noqa: E402


def make_sources(tmp_path):
    races = tmp_path / "src" / "races.json"
    acts = tmp_path / "src" / "activities.json"
    races.parent.mkdir()
    races.write_text('{"races": []}')
    acts.write_text('{"activities": []}')
    return [races, acts]


def test_copies_files_into_a_dated_folder(tmp_path):
    files = make_sources(tmp_path)
    copied = bk.backup(tmp_path / "backups", files, date(2026, 9, 26))
    assert [p.name for p in copied] == ["races.json", "activities.json"]
    assert (tmp_path / "backups" / "2026-09-26" / "races.json").read_text() == '{"races": []}'


def test_same_day_overwrites_and_missing_files_are_skipped(tmp_path):
    races, acts = make_sources(tmp_path)
    bk.backup(tmp_path / "b", [races, acts], date(2026, 9, 26))
    races.write_text('{"races": [1]}')
    acts.unlink()
    copied = bk.backup(tmp_path / "b", [races, acts], date(2026, 9, 26))
    assert [p.name for p in copied] == ["races.json"]
    assert (tmp_path / "b" / "2026-09-26" / "races.json").read_text() == '{"races": [1]}'


def test_keeps_only_the_newest_days_and_leaves_other_folders_alone(tmp_path):
    files = make_sources(tmp_path)
    target = tmp_path / "b"
    (target / "notes").mkdir(parents=True)          # not a date folder: must survive
    for i in range(5):
        bk.backup(target, files, date(2026, 9, 20) + timedelta(days=i), keep=3)
    assert sorted(p.name for p in target.iterdir()) == ["2026-09-22", "2026-09-23", "2026-09-24", "notes"]


def test_backup_dir_prefers_personal_onedrive_never_the_work_one(tmp_path, monkeypatch):
    personal, work = tmp_path / "OneDrive", tmp_path / "OneDrive - Contoso"
    personal.mkdir(); work.mkdir()
    monkeypatch.delenv("BACKUP_DIR", raising=False)
    monkeypatch.setenv("OneDrive", str(work))            # on this machine %OneDrive% is the school one
    monkeypatch.setenv("OneDriveConsumer", str(personal))
    assert bk.backup_dir() == personal / bk.FOLDER_NAME
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "custom"))
    assert bk.backup_dir() == tmp_path / "custom"
    monkeypatch.delenv("BACKUP_DIR")
    monkeypatch.delenv("OneDriveConsumer")
    assert bk.backup_dir() == bk.ROOT / "data" / "backups", "no personal OneDrive: stay on this computer"
