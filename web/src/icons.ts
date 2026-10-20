const NS = "http://www.w3.org/2000/svg";

/** 24x24 stroke icons. Each value is one or more path segments. Icons are decorative: the button that holds one carries the accessible name. */
export const ICONS = {
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M8 8h8v8H8z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6L6 18",
  list: "M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17",
  pin: "M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
  bookmark: "M7 4h10v16l-5-3.5L7 20z",
  flag: "M5 21V4M5 4h12l-2.5 4L17 12H5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  thumb: "M7 11v9H4v-9h3zm2 9V11l4-8c1.3 0 2.2 1 2 2.3L14.8 9H20a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.6 20H9z",
  sun: "M12 16a4 4 0 100-8 4 4 0 000 8zM12 2.5v2M12 19.5v2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M2.5 12h2M19.5 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  auto: "M4 5h16v11H4zM9 20h6M12 16v4",
  chevron: "M6 9l6 6 6-6",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  circleCheck: "M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l3 3 5-6",
  circleMinus: "M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 12h7",
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ico");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** Swap the icon inside a button (keeps any other children, e.g. a count badge). */
export function setIcon(btn: HTMLElement, name: IconName) {
  btn.dataset.icon = name;
  const old = btn.querySelector(":scope > svg.ico");
  const next = icon(name);
  if (old) old.replaceWith(next); else btn.prepend(next);
}

/** Give a button its accessible name and a hover tooltip. */
export function label(btn: HTMLElement, text: string, tip = text) {
  btn.setAttribute("aria-label", text);
  btn.title = tip;
}

/** Fill every `[data-icon]` element in static HTML with its icon. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((b) => setIcon(b, b.dataset.icon as IconName));
}
