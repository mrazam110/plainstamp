from dataclasses import dataclass, field


@dataclass
class Section:
    heading: str
    text: str


@dataclass
class Document:
    source_id: str
    doc_id: str
    url: str
    region_id: str
    topic_key: str
    title: str
    language: str
    crawled_at: str
    content_hash: str
    leika_key: str | None = None
    sections: list[Section] = field(default_factory=list)


@dataclass
class Chunk:
    id: str
    doc_id: str
    source_id: str
    region_id: str
    topic_key: str
    leika_key: str | None
    url: str
    title: str
    heading: str
    crawled_at: str
    text: str
