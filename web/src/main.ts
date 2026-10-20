import regionsJson from "./regions.generated.json";
import { ApiError, streamAsk, type AskBody } from "./api";
import { checklistItems, renderAnswer, reportText, safeUrl } from "./format";
import { createTurnstile, loadTurnstileScript } from "./turnstile";
import { PLACEHOLDERS, TOPICS } from "./topics";
import { createStore, type ChatMessage, type Settings } from "./storage";

interface Region { id: string; name: string; level: string; coverage: string; children?: Region[] }
const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8787";
const SITEKEY = (import.meta as any).env?.VITE_TURNSTILE_SITEKEY as string | undefined;
const turnstile = SITEKEY ? createTurnstile(SITEKEY, { load: loadTurnstileScript, container: "#bot-check" }) : null;
const states = ((regionsJson as Region).children ?? []).filter((r) => r.level === "land");
const stateName = (id: string) => states.find((s) => s.id === id)?.name ?? id;
const covered = (r: Region) => r.coverage === "pilot" || r.coverage === "federal";

const store = (() => {
  try { return createStore(localStorage); } catch { return createStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} }); }
})();
let settings: Settings = store.settings();
let history: ChatMessage[] = store.history();
let checklist = store.checklist();
let controller: AbortController | null = null;
let generation = 0; // bumped by Clear data so a stream that was in flight cannot write history back

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function save() { store.saveSettings(settings); }

// ---------- context bar ----------
function fillSelect(sel: HTMLSelectElement, value: string, placeholder: string) {
  sel.replaceChildren(new Option(placeholder, ""));
  for (const s of states) sel.append(new Option(covered(s) ? s.name : `${s.name} (not covered yet)`, s.id));
  sel.value = value;
}
function renderContext() {
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === settings.mode)));
  $("state-field").hidden = settings.mode !== "state";
  $("from-field").hidden = $("to-field").hidden = settings.mode !== "move";
  fillSelect($("state") as HTMLSelectElement, settings.state, "Not sure");
  fillSelect($("from") as HTMLSelectElement, settings.fromState, "Choose");
  fillSelect($("to") as HTMLSelectElement, settings.toState, "Choose");
  ($("situation") as HTMLInputElement).value = settings.situation;
  ($("language") as HTMLSelectElement).value = settings.language;
  $("ctx-toggle").textContent = summary();
}
function bindContext() {
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
    b.addEventListener("click", () => { settings.mode = b.dataset.mode as Settings["mode"]; save(); renderContext(); }));
  $("ctx-toggle").addEventListener("click", () => setContextOpen($("ctx").dataset.open !== "true"));
  const on = (id: string, key: "state" | "fromState" | "toState" | "situation" | "language") =>
    $(id).addEventListener("change", (e) => { settings[key] = (e.target as HTMLInputElement).value; save(); $("ctx-toggle").textContent = summary(); });
  on("state", "state"); on("from", "fromState"); on("to", "toState"); on("situation", "situation"); on("language", "language");
}
/** What the Worker is told: incomplete choices fall back to the broader scope. */
function requestContext(): AskBody["context"] {
  const base = { situation: settings.situation.trim() || undefined, language: settings.language || undefined };
  if (settings.mode === "move" && settings.fromState && settings.toState) return { mode: "move", fromState: settings.fromState, toState: settings.toState, ...base };
  if (settings.mode === "state" && settings.state) return { mode: "state", state: settings.state, ...base };
  return { mode: "germany", ...base };
}

function summary(): string {
  const c = requestContext();
  const place = c.mode === "move" ? `${stateName(c.fromState!)} \u2192 ${stateName(c.toState!)}` : c.mode === "state" ? stateName(c.state!) : "Germany-wide";
  const lang = settings.language ? ($("language") as HTMLSelectElement).selectedOptions[0]?.text : "";
  return [place, settings.situation.trim() ? "situation set" : "", lang].filter(Boolean).join(" \u00B7 ");
}
function setContextOpen(open: boolean) {
  $("ctx").dataset.open = String(open);
  $("ctx-toggle").setAttribute("aria-expanded", String(open));
  $("ctx-toggle").textContent = summary();
}

// ---------- messages ----------
function sourceCards(m: ChatMessage): HTMLElement | null {
  if (!m.citations?.length) return null;
  const wrap = el("div", "sources");
  for (const c of m.citations) {
    const card = el("div", "source");
    card.id = `src-${c.n}`;
    const head = el("div");
    head.append(el("span", "badge", c.regionName), el("strong", undefined, `[${c.n}] ${c.title}`));
    const meta = el("div", "meta", `${c.heading} · checked ${c.crawledAt}`);
    const a = el("a", undefined, "Open official page");
    a.href = safeUrl(c.url); a.target = "_blank"; a.rel = "noopener noreferrer";
    const copy = el("button", "ghost", "Copy German title");
    copy.type = "button"; copy.style.minHeight = "32px";
    copy.addEventListener("click", () => copyText(c.title, copy, "Copied"));
    card.append(head, meta, a, document.createTextNode(" "), copy);
    wrap.append(card);
  }
  return wrap;
}

async function copyText(text: string, btn: HTMLElement, done: string) {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = done; } catch { btn.textContent = "Copy failed"; }
  setTimeout(() => { btn.textContent = old; }, 1500);
}

function buildAnswer(m: ChatMessage, question: string, isLast: boolean): HTMLElement {
  const wrap = el("div");
  if (m.notCovered?.length) {
    wrap.append(el("p", "banner", `${m.notCovered.map((r) => r.name).join(", ")} ${m.notCovered.length > 1 ? "are" : "is"} not covered yet. Below is only what applies Germany-wide. Please check with that state's own office.`));
  }
  const body = el("div", "body");
  body.innerHTML = renderAnswer(m.content, m.citations);
  wrap.append(body);
  const cards = sourceCards(m);
  if (cards) wrap.append(cards);
  if (m.answerable === false && m.content) wrap.append(el("p", "banner", "I could not find this in the official pages I have. Please ask the responsible office."));
  const actions = el("div", "actions");
  const steps = checklistItems(m.content);
  if (steps.length) {
    const b = el("button", undefined, "Save steps");
    b.type = "button";
    b.addEventListener("click", () => {
      for (const t of steps) if (!checklist.some((c) => c.text === t)) checklist.push({ id: crypto.randomUUID(), text: t, done: false });
      store.saveChecklist(checklist); renderChecklist(); b.textContent = "Saved";
    });
    actions.append(b);
  }
  const report = el("button", undefined, "Report wrong answer");
  report.type = "button";
  report.title = "Copies a report to paste into an issue. Nothing is sent.";
  report.addEventListener("click", () => copyText(reportText(question, m.content, m.citations ?? []), report, "Copied, paste it into an issue"));
  actions.append(report);
  wrap.append(actions);
  if (m.needsState && isLast) {
    const chips = el("div", "state-chips");
    chips.append(el("span", "muted", "Which state?"));
    for (const s of states.filter(covered)) {
      const b = el("button", undefined, s.name);
      b.type = "button";
      b.addEventListener("click", () => { settings = { ...settings, mode: "state", state: s.id }; save(); renderContext(); send(question, true); });
      chips.append(b);
    }
    wrap.append(chips);
  }
  return wrap;
}

function renderMessages() {
  const list = $("messages");
  list.replaceChildren();
  $("empty").hidden = history.length > 0;
  history.forEach((m, i) => {
    const li = el("li", `msg ${m.role}`);
    if (m.role === "user") li.textContent = m.content;
    else {
      const q = [...history.slice(0, i)].reverse().find((x) => x.role === "user")?.content ?? "";
      li.append(buildAnswer(m, q, i === history.length - 1));
    }
    list.append(li);
  });
  if (history.length) $("chat").scrollTop = $("chat").scrollHeight;
}

// ---------- landing ----------
const SVG = "http://www.w3.org/2000/svg";
function typingDots(): HTMLElement {
  const d = el("div", "typing body"); d.setAttribute("aria-label", "Looking up official pages");
  d.append(el("i"), el("i"), el("i"));
  return d;
}
function renderTopics() {
  const grid = $("topics");
  TOPICS.forEach((t, i) => {
    const card = el("article", "topic"); card.style.setProperty("--i", String(i));
    const svg = document.createElementNS(SVG, "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG, "path"); path.setAttribute("d", t.icon); svg.append(path);
    const icon = el("span", "topic-icon"); icon.append(svg);
    const title = el("h3", undefined, t.title); const de = el("span", undefined, t.de); de.lang = "de"; title.append(de);
    const head = el("div", "topic-head"); head.append(icon, title);
    const ul = el("ul");
    for (const q of t.questions) {
      const b = el("button", undefined, q.text); b.type = "button";
      b.addEventListener("click", () => { settings = { ...settings, ...q.apply }; save(); renderContext(); send(q.text); });
      const li = el("li"); li.append(b); ul.append(li);
    }
    card.append(head, ul); grid.append(card);
  });
  // reveal cards as they scroll into view
  if (!("IntersectionObserver" in window)) { grid.querySelectorAll(".topic").forEach((c) => c.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { root: $("chat"), threshold: 0.1 });
  grid.querySelectorAll(".topic").forEach((c) => io.observe(c));
}
/** Question-box hint: types a line, holds it, deletes it, types the next. The native placeholder keeps the full line (transparent) for screen readers. */
function rotatePlaceholder(q: HTMLTextAreaElement) {
  const ph = $("ph");
  q.placeholder = PLACEHOLDERS[0]!; ph.textContent = PLACEHOLDERS[0]!;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const idle = () => q.value !== "" || document.activeElement === q;
  (async () => {
    let first = true;
    for (let i = 0; ; i = (i + 1) % PLACEHOLDERS.length) {
      const line = PLACEHOLDERS[i]!;
      if (!first) {
        q.placeholder = line;
        ph.classList.add("writing");
        for (let n = 0; n <= line.length; n++) { ph.textContent = line.slice(0, n); await sleep(n === 0 ? 350 : 38 + Math.random() * 40); }
      }
      first = false;
      ph.classList.remove("writing");
      do { await sleep(2200); } while (idle()); // hold; stay put while the user is in the box
      ph.classList.add("writing");
      for (let n = line.length; n >= 0; n--) { ph.textContent = line.slice(0, n); await sleep(18); if (idle()) { ph.textContent = line; ph.classList.remove("writing"); break; } }
    }
  })();
}

// ---------- sending ----------
function setBusy(busy: boolean) {
  ($("send") as HTMLButtonElement).hidden = busy;
  ($("stop") as HTMLButtonElement).hidden = !busy;
  ($("question") as HTMLTextAreaElement).disabled = busy;
}
const ERRORS: Record<string, string> = {
  invalid_request: "That question could not be processed. Try rewording it.",
  too_large: "That is too long. Please shorten it.",
  upstream_error: "The assistant is unavailable right now. Please try again in a moment.",
  network: "Can't reach the server. Check your connection and try again.",
  rate_limited: "Too many questions in a short time. Please wait a minute and try again.",
  turnstile_failed: "The bot check did not complete. Reload the page and try again.",
  guard_unconfigured: "The service is not switched on yet.",
  guard_error: "The service is temporarily unavailable. Please try again later.",
  insecure_api_url: "This page is misconfigured (the API address is not https).",
};

async function send(question: string, retry = false) {
  question = question.trim();
  if (!question || controller) return;
  setContextOpen(false);
  if (retry && history.at(-1)?.role === "model") history.pop(); // asking again after choosing a state
  else history.push({ role: "user", content: question });
  const draft: ChatMessage = { role: "model", content: "" };
  history.push(draft);
  renderMessages();
  setBusy(true);
  controller = new AbortController();
  const myGeneration = generation;
  const live = $("messages").lastElementChild as HTMLElement;
  live.replaceChildren(typingDots());
  const prior = history.slice(0, -2).filter((m) => m.content).slice(-6).map((m) => ({ role: m.role, content: m.content }));
  try {
    const token = turnstile ? await turnstile.getToken() : undefined;
    for await (const ev of streamAsk(API, { question, context: requestContext(), history: prior }, controller.signal, fetch, token)) {
      if (ev.event === "meta") { draft.notCovered = ev.data.notCovered; draft.needsState = ev.data.needsState; }
      else if (ev.event === "delta") {
        draft.content += ev.data.text;
        live.replaceChildren(el("div", "body"));
        (live.firstElementChild as HTMLElement).innerHTML = renderAnswer(draft.content, []);
        $("chat").scrollTop = $("chat").scrollHeight;
      } else if (ev.event === "done") {
        Object.assign(draft, { content: ev.data.answer, citations: ev.data.citations, answerable: ev.data.answerable, needsState: ev.data.needsState, notCovered: ev.data.notCovered });
      } else if (ev.event === "error") throw new ApiError(ev.data.error ?? "upstream_error");
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") draft.content ||= "(stopped)";
    else {
      const code = e instanceof ApiError ? e.code : (e as Error).message === "turnstile_failed" ? "turnstile_failed" : "network";
      const msg = ERRORS[code] ?? ERRORS.upstream_error!;
      history.pop();
      if (draft.content) history.push(draft);
      renderMessages();
      const err = el("li", "msg model"); err.append(el("p", "error", msg));
      $("messages").append(err);
      controller = null; setBusy(false);
      if (myGeneration === generation) store.saveHistory(history);
      return;
    }
  }
  controller = null;
  setBusy(false);
  if (myGeneration !== generation) return; // cleared while streaming: leave the fresh state alone
  store.saveHistory(history);
  renderMessages();
}

// ---------- checklist, coverage, misc ----------
function renderChecklist() {
  const ul = $("checklist");
  ul.replaceChildren();
  for (const item of checklist) {
    const li = el("li", item.done ? "done" : "");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = item.done; cb.setAttribute("aria-label", item.text);
    cb.addEventListener("change", () => { item.done = cb.checked; li.className = item.done ? "done" : ""; store.saveChecklist(checklist); });
    const rm = el("button", "ghost", "Remove"); rm.type = "button";
    rm.addEventListener("click", () => { checklist = checklist.filter((c) => c.id !== item.id); store.saveChecklist(checklist); renderChecklist(); });
    li.append(cb, el("span", undefined, item.text), rm);
    ul.append(li);
  }
  $("checklist-empty").hidden = checklist.length > 0;
  const count = $("checklist-count");
  count.hidden = checklist.length === 0;
  count.textContent = String(checklist.filter((c) => !c.done).length);
}
function renderCoverage() {
  const ul = $("coverage");
  ul.replaceChildren();
  const li0 = el("li"); li0.append(el("span", undefined, "Germany (federal)"), el("span", undefined, "covered")); ul.append(li0);
  for (const s of states) { const li = el("li"); li.append(el("span", undefined, s.name), el("span", s.coverage === "pilot" ? "" : "muted", s.coverage === "pilot" ? "covered (pilot)" : "not yet")); ul.append(li); }
}
function applyTheme() {
  if (settings.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = settings.theme;
  $("btn-theme").textContent = `Theme: ${settings.theme}`;
}

/** Header menu: closes on outside click or Escape, and Escape returns focus to the button. */
function bindPopovers() {
  const menuBtn = $("btn-menu"), menu = $("menu");
  const setMenu = (open: boolean) => { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", () => setMenu(menu.hidden === true));
  menu.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button, a") && (e.target as HTMLElement).id !== "btn-theme") setMenu(false); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.parentElement!.contains(e.target as Node)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
}

function init() {
  renderContext(); bindContext(); renderChecklist(); renderCoverage(); applyTheme(); renderMessages();
  setContextOpen(false); // landing keeps the hero in view; the "Applies to" chip opens it
  $("privacy-note").hidden = settings.privacyNoticeDismissed;
  $("privacy-ok").addEventListener("click", () => { settings.privacyNoticeDismissed = true; save(); $("privacy-note").hidden = true; });
  renderTopics();
  const q = $("question") as HTMLTextAreaElement;
  const grow = () => { q.style.height = "auto"; q.style.height = `${Math.min(q.scrollHeight, 160)}px`; };
  rotatePlaceholder(q);
  q.addEventListener("input", grow);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ($("composer") as HTMLFormElement).requestSubmit(); } });
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); const t = q.value; q.value = ""; grow(); send(t); });
  $("stop").addEventListener("click", () => controller?.abort());
  $("chat").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("term")) copyText(t.dataset.copy ?? "", t, `(${t.dataset.copy}) copied`);
    if (t.classList.contains("cite")) { e.preventDefault(); const c = document.getElementById(`src-${t.dataset.n}`); c?.scrollIntoView({ block: "center" }); c?.classList.add("flash"); setTimeout(() => c?.classList.remove("flash"), 1200); }
  });
  $("btn-checklist").addEventListener("click", () => ($("dlg-checklist") as HTMLDialogElement).showModal());
  const openCoverage = () => ($("dlg-coverage") as HTMLDialogElement).showModal();
  $("btn-coverage").addEventListener("click", openCoverage);
  $("menu-coverage").addEventListener("click", openCoverage);
  $("checklist-clear").addEventListener("click", () => { checklist = []; store.saveChecklist(checklist); renderChecklist(); });
  $("btn-theme").addEventListener("click", () => { settings.theme = settings.theme === "auto" ? "light" : settings.theme === "light" ? "dark" : "auto"; save(); applyTheme(); });
  const clearDlg = $("dlg-clear") as HTMLDialogElement;
  $("btn-clear").addEventListener("click", () => { clearDlg.returnValue = ""; clearDlg.showModal(); });
  clearDlg.addEventListener("close", () => {
    if (clearDlg.returnValue !== "confirm") return;
    generation++; controller?.abort(); store.clearAll();
    settings = store.settings(); history = []; checklist = [];
    renderContext(); renderMessages(); renderChecklist(); applyTheme(); $("privacy-note").hidden = false; setContextOpen(true);
  });
  bindPopovers();
}
init();
