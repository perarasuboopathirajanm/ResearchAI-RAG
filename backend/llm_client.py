# =============================================================================
#  ResearchAI - Neural RAG Research Assistant
#  Copyright (c) 2026 Perarasu Boopathirajan. All rights reserved.
#  Author: Perarasu Boopathirajan
#  Unauthorized copying, redistribution or claiming authorship of this file,
#  via any medium, is prohibited without written permission. See LICENSE.
# =============================================================================
"""
Answer-generation layer.

By default ResearchAI answers with a SELF-HOSTED model served by Ollama on
this machine (http://localhost:11434). Questions and document text never leave
the computer - no third-party API, no API key.

A cloud provider (Groq) can optionally be enabled with LLM_PROVIDER=groq.
"""
import os
from typing import List, Dict

import httpx


class LLMError(RuntimeError):
    """Raised with a human-readable message when the model cannot answer."""


class LocalLLM:
    """Self-hosted model served by Ollama (private, offline, free)."""

    provider = "local"

    def __init__(self):
        self.base_url = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
        self.model_name = os.getenv("LOCAL_MODEL", "llama3.2:3b")
        self.timeout = float(os.getenv("LLM_TIMEOUT", "300"))

    @property
    def label(self) -> str:
        return f"Local · {self.model_name}"

    def status(self) -> Dict[str, object]:
        """Check that Ollama is running and the model is downloaded."""
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=3)
            r.raise_for_status()
            names = {m.get("name", "") for m in r.json().get("models", [])}
            ready = self.model_name in names or f"{self.model_name}:latest" in names
            return {"reachable": True, "model_ready": ready}
        except Exception:
            return {"reachable": False, "model_ready": False}

    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.3, max_tokens: int = 2048) -> str:
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        try:
            r = httpx.post(f"{self.base_url}/api/chat", json=payload, timeout=self.timeout)
        except httpx.ConnectError:
            raise LLMError(
                f"Cannot reach the local model server at {self.base_url}. "
                "Install Ollama (https://ollama.com) and make sure it is running."
            )
        except httpx.TimeoutException:
            raise LLMError("The local model took too long to answer. Try a smaller model or a shorter question.")

        if r.status_code == 404:
            raise LLMError(
                f"Local model '{self.model_name}' is not downloaded yet. "
                f"Run:  ollama pull {self.model_name}"
            )
        if r.status_code >= 400:
            raise LLMError(f"Local model error ({r.status_code}): {r.text[:300]}")

        return (r.json().get("message", {}).get("content") or "").strip()


class GroqLLM:
    """Optional cloud provider. Text IS sent to Groq's servers."""

    provider = "groq"

    def __init__(self):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("LLM_PROVIDER=groq but GROQ_API_KEY is not set in .env")
        from groq import Groq  # imported only when the cloud option is used
        self.client = Groq(api_key=api_key)
        self.model_name = os.getenv("MODEL_NAME", "openai/gpt-oss-20b")

    @property
    def label(self) -> str:
        return f"Groq Cloud · {self.model_name}"

    def status(self) -> Dict[str, object]:
        return {"reachable": True, "model_ready": True}

    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.3, max_tokens: int = 2048) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.model_name, messages=messages,
                temperature=temperature, max_tokens=max_tokens,
            )
        except Exception as e:
            raise LLMError(f"Groq API error: {e}")
        return (response.choices[0].message.content or "").strip()


def create_llm():
    provider = os.getenv("LLM_PROVIDER", "local").strip().lower()
    if provider in ("local", "ollama"):
        return LocalLLM()
    if provider == "groq":
        return GroqLLM()
    raise ValueError(f"Unknown LLM_PROVIDER '{provider}'. Use 'local' or 'groq'.")
