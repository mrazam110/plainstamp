import re

from bs4 import BeautifulSoup

from .htmltext import block_text, clean, make_document
from .model import Section

SKIP_HEADINGS = {"Für Sie zuständig", "Online-Abwicklung"}  # offices move to Phase 8
MAIN = "#layout-grid__area--maincontent"


def service_url(service_id) -> str:
    return f"https://service.berlin.de/dienstleistung/{service_id}/"


def parse_service(html, service_id, topic_key, source_id="berlin-dldb", crawled_at=None):
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one(MAIN)
    if main is None:
        raise ValueError(f"service {service_id}: main content not found")
    m = re.search(r"leistungId=(99\d{12})", str(main))
    leika_key = m.group(1) if m else None
    for tag in main(["script", "style", "noscript"]):
        tag.decompose()
    h1 = main.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    sections = []
    for block in main.find_all("div", class_="block", recursive=False):
        if "modul-servicepanel" in (block.get("class") or []):
            continue
        h2 = block.find("h2")
        heading = clean(h2.get_text(" ", strip=True)) if h2 else "Überblick"
        if heading in SKIP_HEADINGS:
            continue
        if h2:
            h2.decompose()
        text = block_text(block)
        if text:
            sections.append(Section(heading, text))
    return make_document(source_id=source_id, prefix="berlin", item_id=service_id,
                         url=service_url(service_id), region_id="de-be", topic_key=topic_key,
                         title=title, sections=sections, leika_key=leika_key, crawled_at=crawled_at)
