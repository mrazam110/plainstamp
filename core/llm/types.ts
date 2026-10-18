export interface Message {
  role: "user" | "model";
  content: string;
}

export interface GenerateRequest {
  system?: string;
  messages: Message[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for JSON output; pass a Gemini-style schema to constrain it. */
  json?: { schema?: unknown };
}

export interface GenerateResult {
  text: string;
  finishReason?: string;
}

/** The only way the pipeline talks to a language model; providers live behind it. */
export interface LLM {
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** Text deltas in order. */
  stream(req: GenerateRequest): AsyncIterable<string>;
}
