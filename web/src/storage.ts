export interface Settings {
  mode: "germany" | "state" | "move";
  state: string;
  fromState: string;
  toState: string;
  situation: string;
  language: string;
  theme: "auto" | "light" | "dark";
  privacyNoticeDismissed: boolean;
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
  citations?: Citation[];
  notCovered?: { id: string; name: string }[];
  needsState?: boolean;
  answerable?: boolean;
  /** Which button the visitor pressed; kept in this browser only so the buttons stay greyed after a reload. */
  vote?: "up" | "down";
}

/** One conversation. Lives in this browser only, like everything else. */
export interface Chat {
  id: string;
  title: string;
  updatedAt: number;
  /** Set once the visitor names the chat; the first question no longer renames it. */
  renamed?: boolean;
  messages: ChatMessage[];
}

export interface Citation {
  n: number;
  docId?: string;
  title: string;
  heading: string;
  url: string;
  crawledAt: string;
  regionId: string;
  regionName: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export const DEFAULTS: Settings = {
  mode: "germany", state: "", fromState: "", toState: "", situation: "", language: "", theme: "auto", privacyNoticeDismissed: false,
};

// `history` is the single-conversation key from before chats existed; it is read once and migrated.
const KEYS = { settings: "plainstamp.v1.settings", history: "plainstamp.v1.history", chats: "plainstamp.v1.chats", active: "plainstamp.v1.active", checklist: "plainstamp.v1.checklist" } as const;
const MAX_MESSAGES = 60;
const MAX_CHATS = 20;
export const NEW_CHAT_TITLE = "New chat";
export const MAX_TITLE = 60;

/** A name typed by the visitor: spaces tidied, cut at MAX_TITLE. Empty means "name it after the first question again". */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trimEnd();
}

/** A chat is named after its first question. */
export function chatTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim();
  if (!first) return NEW_CHAT_TITLE;
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}\u2026` : first;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Everything lives in the browser. Reads and writes never throw (private mode, blocked storage). */
export function createStore(kv: KV) {
  const read = <T>(key: string, fallback: T): T => {
    try {
      const raw = kv.getItem(key);
      return raw ? ({ ...(Array.isArray(fallback) ? [] : fallback as object), ...JSON.parse(raw) } as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const readList = <T>(key: string): T[] => {
    try {
      const v = JSON.parse(kv.getItem(key) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const write = (key: string, value: unknown): boolean => {
    try {
      kv.setItem(key, JSON.stringify(value));
      return true;
    } catch { return false; /* storage unavailable: the page still works for this session */ }
  };
  return {
    settings: () => read<Settings>(KEYS.settings, { ...DEFAULTS }),
    saveSettings: (s: Settings) => write(KEYS.settings, s),
    /** Newest first. Picks up an old single history once and turns it into the first chat. */
    chats(): Chat[] {
      const list = readList<Chat>(KEYS.chats).filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages));
      if (list.length) return list.sort((a, b) => b.updatedAt - a.updatedAt);
      const legacy = readList<ChatMessage>(KEYS.history);
      return legacy.length ? [{ id: crypto.randomUUID(), title: chatTitle(legacy), updatedAt: Date.now(), messages: legacy }] : [];
    },
    /** Keeps the newest chats; if the browser quota is hit, drops the oldest until it fits. */
    saveChats(chats: Chat[]) {
      let keep = chats.slice(0, MAX_CHATS).map((c) => ({ ...c, messages: c.messages.slice(-MAX_MESSAGES) }));
      while (!write(KEYS.chats, keep) && keep.length > 1) keep = keep.slice(0, -1);
      try { kv.removeItem(KEYS.history); } catch { /* ignore */ }
    },
    activeId: () => { try { return kv.getItem(KEYS.active); } catch { return null; } },
    saveActiveId: (id: string) => { try { kv.setItem(KEYS.active, id); } catch { /* ignore */ } },
    checklist: () => readList<ChecklistItem>(KEYS.checklist),
    saveChecklist: (c: ChecklistItem[]) => write(KEYS.checklist, c),
    clearAll() {
      for (const k of Object.values(KEYS)) {
        try { kv.removeItem(k); } catch { /* ignore */ }
      }
    },
  };
}
