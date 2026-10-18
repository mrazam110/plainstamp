import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlsplit

import requests

from .sources import USER_AGENT


class Fetcher:
    """Polite fetcher: identifying User-Agent, robots.txt, crawl delay, local raw cache."""

    def __init__(self, cache_dir: Path, delay: float = 2.0, session=None):
        self.cache_dir = Path(cache_dir)
        self.delay = delay
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._last = 0.0

    def _rp(self, url: str) -> urllib.robotparser.RobotFileParser:
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            resp = self.session.get(base + "/robots.txt", timeout=20)
            rp.parse(resp.text.splitlines() if resp.status_code == 200 else [])
            self._robots[base] = rp
        return self._robots[base]

    def _wait(self, url: str) -> None:
        crawl_delay = self._rp(url).crawl_delay(USER_AGENT) or 0
        gap = max(self.delay, float(crawl_delay))
        remaining = self._last + gap - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    def _get_retry(self, url: str, tries: int = 3):
        for attempt in range(tries):
            try:
                return self.session.get(url, timeout=30)
            except requests.exceptions.ConnectionError:  # idle keep-alive dropped by the server
                if attempt == tries - 1:
                    raise
                self.session.close()
                time.sleep(self.delay)

    def get(self, url: str, cache_name: str, refresh: bool = False) -> str:
        path = self.cache_dir / cache_name
        if path.exists() and not refresh:
            return path.read_text(encoding="utf-8")
        if not self._rp(url).can_fetch(USER_AGENT, url):
            raise PermissionError(f"robots.txt disallows {url}")
        self._wait(url)
        resp = self._get_retry(url)
        self._last = time.monotonic()
        resp.raise_for_status()
        if "charset" not in resp.headers.get("content-type", "").lower():
            resp.encoding = "utf-8"  # requests would guess Latin-1; pages declare UTF-8 in <meta>
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text, encoding="utf-8")
        return resp.text
