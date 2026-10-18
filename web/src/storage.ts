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

const KEYS = { settings: "plainstamp.v1.settings", history: "plainstamp.v1.history", checklist: "plainstamp.v1.checklist" } as const;
const MAX_MESSAGES = 60;

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
  const write = (key: string, value: unknown) => {
    try {
      kv.setItem(key, JSON.stringify(value));
    } catch { /* storage unavailable: the page still works for this session */ }
  };
  return {
    settings: () => read<Settings>(KEYS.settings, { ...DEFAULTS }),
    saveSettings: (s: Settings) => write(KEYS.settings, s),
    history: () => readList<ChatMessage>(KEYS.history),
    saveHistory: (h: ChatMessage[]) => write(KEYS.history, h.slice(-MAX_MESSAGES)),
    checklist: () => readList<ChecklistItem>(KEYS.checklist),
    saveChecklist: (c: ChecklistItem[]) => write(KEYS.checklist, c),
    clearAll() {
      for (const k of Object.values(KEYS)) {
        try { kv.removeItem(k); } catch { /* ignore */ }
      }
    },
  };
}
