from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
USER_AGENT = "Plainstamp-ingest/0.1 (+https://github.com/mrazam110/plainstamp)"


def load_source(source_id: str, root: Path = ROOT) -> dict:
    """Load sources/de/<source_id>.yaml and refuse sources not cleared for local work."""
    path = root / "sources" / "de" / f"{source_id}.yaml"
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not cfg.get("crawl", {}).get("allowed_local_dev"):
        raise PermissionError(f"{source_id}: crawl.allowed_local_dev is not true")
    return cfg
