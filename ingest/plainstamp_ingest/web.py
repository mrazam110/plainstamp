"""Generic adapter for federal pages: <main> split into sections at each <h2> or <h3>."""
import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from .htmltext import clean, make_document
from .model import Section

SKIP_HEADINGS = {"Downloads", "Downloadbereich", "Weitere Informationen", "Kontakt"}


def service_url(item_id) -> str:  # urls come from the seed list
    raise NotImplementedError("web seeds carry their own url")


def parse_service(html, item_id, topic_key, source_id="federal", crawled_at=None,
                  url="", region_id="de", stop_at=(), skip_headings=()):
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("main")
    if main is None:
        raise ValueError(f"{item_id}: <main> not found")
    for tag in main(["script", "style", "noscript", "nav", "form", "button"]):
        tag.decompose()
    h1 = main.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    sections, heading, lines = [], "Überblick", []

    def flush():
        if lines and heading not in SKIP_HEADINGS and heading not in skip_headings:
            sections.append(Section(heading, "\n".join(lines)))

    for el in main.find_all(["h2", "h3", "p", "li"]):
        if el.name in ("h2", "h3"):
            if clean(el.get_text(" ", strip=True)) in stop_at:
                break
            flush()
            heading, lines = clean(el.get_text(" ", strip=True)), []
        elif el.name == "p" and el.find_parent("li"):
            continue
        else:
            t = clean(el.get_text(" ", strip=True))
            if t:
                lines.append(("- " if el.name == "li" else "") + t)
    flush()
    slug = re.sub(r"[^a-z0-9]+", "-", item_id.lower()).strip("-")
    return make_document(source_id=source_id, prefix="de", item_id=slug, url=url,
                         region_id=region_id, topic_key=topic_key, title=title,
                         sections=sections, crawled_at=crawled_at)
