from bs4 import BeautifulSoup

from .htmltext import block_text, clean, make_document
from .model import Section

SKIP_IDS = {"kontaktmoeglichkeiten"}  # contacts are per office; offices move to Phase 8


def service_url(bus_id) -> str:
    return f"https://verwaltung.brandenburg.de/verwalt/de/detail/?bus_id={bus_id}&bus_type=pst"


def parse_service(html, bus_id, topic_key, source_id="brandenburg-service", crawled_at=None):
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("#maincontent")
    if main is None:
        raise ValueError(f"service {bus_id}: main content not found")
    for tag in main(["script", "style", "noscript"]):
        tag.decompose()
    h1 = main.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    sections = []
    for h2 in main.find_all("h2", id=True):
        if h2["id"] in SKIP_IDS or h2.parent.name != "section":
            continue
        sec = h2.parent
        h2.extract()
        text = block_text(sec)
        if text:
            sections.append(Section(clean(h2.get_text(" ", strip=True)), text))
    return make_document(source_id=source_id, prefix="bb", item_id=bus_id, url=service_url(bus_id),
                         region_id="de-bb", topic_key=topic_key, title=title,
                         sections=sections, crawled_at=crawled_at)
