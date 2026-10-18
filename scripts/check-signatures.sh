#!/bin/sh
# Reads text on stdin; exits 1 if it contains a tool/LLM signature line (ADR 0010).
if grep -qiE '^(co-authored-by:.*(claude|anthropic|gpt|openai|gemini|copilot|cursor))|generated (with|by) .*(claude|gpt|gemini|copilot|cursor|\bai\b)'; then
  echo "Found a tool/LLM signature line; remove it (see ADR 0010)." >&2
  exit 1
fi
