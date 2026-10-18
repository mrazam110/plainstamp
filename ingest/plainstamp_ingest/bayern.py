from bs4 import BeautifulSoup

from .htmltext import block_text, clean, make_document
from .model import Section

SKIP_HEADINGS = {"Verwandte Themen"}  # navigation, and "Für Sie zuständig" is per municipality


def service_url(item_id) -> str:
    return f"https://www.bayernportal.de/dokumente/leistung/{item_id}"


def parse_service(html, item_id, topic_key, source_id="bayernportal", crawled_at=None):
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("#mainContent")
    if main is None:
        raise ValueError(f"service {item_id}: main content not found")
    for tag in main(["script", "style", "noscript"]):
        tag.decompose()
    h1 = main.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    sections = []
    for acc in main.select("div.accordion"):
        h3 = acc.find("h3")
        body = acc.select_one(".accordion-content")
        if h3 is None or body is None:
            continue
        heading = clean(h3.get_text(" ", strip=True))
        text = block_text(body)
        if heading not in SKIP_HEADINGS and text:
            sections.append(Section(heading, text))
    return make_document(source_id=source_id, prefix="by", item_id=item_id, url=service_url(item_id),
                         region_id="de-by", topic_key=topic_key, title=title,
                         sections=sections, crawled_at=crawled_at)
