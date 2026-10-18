import type { Message } from "../llm/types";

export interface RegionNode {
  id: string;
  name: string;
  level: string;
  /** federal | pilot | none (regions/de.yaml). Never hardcode a state in code; read this. */
  coverage: string;
  children?: RegionNode[];
}

export interface Topic {
  key: string;
  label: string;
  state_specific: boolean;
}

export interface Config {
  regions: RegionNode;
  topics: Topic[];
}

export interface AskContext {
  mode: "germany" | "state" | "move";
  state?: string;
  fromState?: string;
  toState?: string;
  situation?: string;
  /** Preferred answer language (ISO 639-1); otherwise the question's language. */
  language?: string;
}

export interface AskRequest {
  question: string;
  context: AskContext;
  /** Recent turns, kept by the browser and sent with each request. */
  history?: Message[];
}

export interface Citation {
  n: number;
  docId: string;
  title: string;
  heading: string;
  url: string;
  crawledAt: string;
  regionId: string;
  regionName: string;
}

export interface AskResponse {
  answer: string;
  /** Sources the answer actually cites, numbered as in the text. */
  citations: Citation[];
  /** False when no cited source supports the answer (the answer then says so). */
  answerable: boolean;
  /** Germany-only question on a state-specific topic: federal overview plus a question back. */
  needsState: boolean;
  /** Selected regions the corpus does not cover; never searched. */
  notCovered: { id: string; name: string }[];
  language: string;
}

export class AskError extends Error {}
