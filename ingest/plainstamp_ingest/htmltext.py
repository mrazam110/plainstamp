import hashlib
import re
from datetime import date

from .model import Document, Section


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def block_text(el) -> str:
    """Paragraphs and list items as lines (list items prefixed '- '); fallback to plain text."""
    lines = []
    for node in el.find_all(["p", "li"]):
        if node.name == "p" and node.find_parent("li"):
            continue
        t = clean(node.get_text(" ", strip=True))
        if t:
            lines.append(("- " if node.name == "li" else "") + t)
    if not lines:
        lines = [t for t in (clean(x) for x in el.get_text("\n", strip=True).split("\n")) if t]
    return "\n".join(lines)


def make_document(*, source_id, prefix, item_id, url, region_id, topic_key, title,
                  sections: list[Section], leika_key=None, crawled_at=None) -> Document:
    body = "\n".join(f"{s.heading}\n{s.text}" for s in sections)
    return Document(
        source_id=source_id, doc_id=f"{prefix}-{item_id}", url=url, region_id=region_id,
        topic_key=topic_key, title=title, language="de",
        crawled_at=crawled_at or date.today().isoformat(),
        content_hash=hashlib.sha256(body.encode()).hexdigest()[:16],
        leika_key=leika_key, sections=sections)
