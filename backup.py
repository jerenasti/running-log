"""Back up the files that cannot be fetched from Garmin again.

Usage:
    uv run --no-project python backup.py

Copies content/races.json (your races and goal) and data/activities.json (it holds the training plan
history, which Garmin drops) into a dated folder, one per day, and keeps the newest KEEP_DAYS folders.

Where: the BACKUP_DIR environment variable if set, otherwise your personal OneDrive
(%OneDriveConsumer%, not a work or school OneDrive), otherwise data/backups in this project.
"""

import os
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
FILES = [ROOT / "content" / "races.json", ROOT / "data" / "activities.json"]
KEEP_DAYS = 30
FOLDER_NAME = "Juoksupaivakirja-varmuuskopio"


def backup_dir() -> Path:
    """Where backups go. %OneDrive% can point to a work/school OneDrive, so only the personal one is used."""
    if os.getenv("BACKUP_DIR"):
        return Path(os.environ["BACKUP_DIR"])
    personal = os.getenv("OneDriveConsumer")
    if personal and Path(personal).is_dir():
        return Path(personal) / FOLDER_NAME
    return ROOT / "data" / "backups"


def backup(target: Path, files: list[Path], today: date, keep: int = KEEP_DAYS) -> list[Path]:
    """Copy files into target/YYYY-MM-DD (overwriting today's copy) and delete the oldest day folders.
    Returns the copied files. Missing source files are skipped."""
    day = target / today.isoformat()
    day.mkdir(parents=True, exist_ok=True)
    copied = []
    for f in files:
        if f.is_file():
            copied.append(Path(shutil.copy2(f, day / f.name)))
    # Only folders named like dates are ours to delete
    days = sorted(p for p in target.iterdir() if p.is_dir() and len(p.name) == 10 and p.name[4] == "-" and p.name[7] == "-")
    for old in days[:-keep]:
        shutil.rmtree(old)
    return copied


def main() -> None:
    target = backup_dir()
    copied = backup(target, FILES, date.today())
    if not copied:
        sys.exit("Backup: nothing to copy (content/races.json and data/activities.json are both missing).")
    print(f"Backup: {', '.join(p.name for p in copied)} -> {copied[0].parent}")


if __name__ == "__main__":
    main()
