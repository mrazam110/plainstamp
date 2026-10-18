import type { Citation } from "./storage";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** German-looking term in brackets, e.g. "(Anmeldung)" or "(Wohnungsgeberbestätigung)": gets a copy button. */
const TERM = /\(([A-ZÄÖÜ][\wäöüßÄÖÜ-]+(?: [\wäöüßÄÖÜ-]+){0,3})\)/g;

function inline(s: string, citationNs: Set<number>): string {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[(\d+)\]/g, (m, d: string) =>
    citationNs.has(Number(d)) ? `<a class="cite" href="#src-${d}" data-n="${d}">${d}</a>` : "",
  );
  out = out.replace(TERM, (_m, term: string) => `<button type="button" class="term" data-copy="${term}" title="Copy German term">(${term})</button>`);
  return out;
}

/**
 * Answer text to HTML: escape first, then a small markdown subset (paragraphs, lists, bold),
 * citation links only for sources the answer really has, copy buttons for German terms.
 */
export function renderAnswer(text: string, citations: Citation[] = []): string {
  const ns = new Set(citations.map((c) => c.n));
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const kind = li[1] ? "ol" : "ul";
      if (list !== kind) { close(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inline(li[2]!, ns)}</li>`);
    } else if (line.trim() === "") {
      close();
    } else {
      close();
      html.push(`<p>${inline(line, ns)}</p>`);
    }
  }
  close();
  return html.join("");
}

/** Lines of an answer that are list items, for the checklist (citations and bold stripped). */
export function checklistItems(text: string): string[] {
  return text.split("\n")
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => x.replace(/\[\d+\]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function safeUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "#";
  } catch {
    return "#";
  }
}

export function reportText(question: string, answer: string, citations: Citation[], date = new Date()): string {
  return [
    `Wrong or unclear answer (reported ${date.toISOString().slice(0, 10)})`,
    "", "Before you post this: remove names, addresses, ID numbers and anything else personal.",
    "", "Question:", question, "", "Answer:", answer, "",
    "Sources:", ...citations.map((c) => `[${c.n}] ${c.regionName}: ${c.title} - ${c.url} (checked ${c.crawledAt})`),
    "", "What is wrong:", "",
  ].join("\n");
}
