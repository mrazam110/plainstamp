import hashlib

from .model import Chunk, Document

MAX_CHARS = 1200


def _split(text: str, limit: int) -> list[str]:
    parts, cur = [], ""
    for line in text.split("\n"):
        while len(line) > limit:  # very long line: cut at a space
            cut = line.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit
            parts_line, line = line[:cut], line[cut:].lstrip()
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(parts_line)
        if cur and len(cur) + len(line) + 1 > limit:
            parts.append(cur)
            cur = ""
        cur = f"{cur}\n{line}" if cur else line
    if cur:
        parts.append(cur)
    return parts


def chunk_document(doc: Document, limit: int = MAX_CHARS) -> list[Chunk]:
    """One chunk per section piece; every chunk text starts with title and heading."""
    chunks = []
    for s in doc.sections:
        for i, piece in enumerate(_split(s.text, limit)):
            text = f"{doc.title}\n{s.heading}\n{piece}"
            cid = hashlib.sha1(f"{doc.doc_id}|{s.heading}|{i}|{piece}".encode()).hexdigest()[:16]
            chunks.append(Chunk(
                id=cid, doc_id=doc.doc_id, source_id=doc.source_id, region_id=doc.region_id,
                topic_key=doc.topic_key, leika_key=doc.leika_key, url=doc.url,
                title=doc.title, heading=s.heading, crawled_at=doc.crawled_at, text=text,
            ))
    return chunks
