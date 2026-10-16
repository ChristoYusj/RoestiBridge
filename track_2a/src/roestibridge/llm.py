"""Minimal OpenAI-compatible chat client (stdlib only, so the Docker image stays tiny)."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


class LLMError(RuntimeError):
    pass


def config_from_env() -> dict:
    cfg = {
        "model": os.environ.get("LLM_NAME", "swiss-ai/Apertus-v1.5-70B"),
        "base_url": os.environ.get("LLM_BASE_URL", "https://api.inference.cscs.ch/v1").rstrip("/"),
        "api_key": os.environ.get("LLM_API_KEY", ""),
    }
    return cfg


def chat(messages: list[dict], cfg: dict, *, temperature: float = 0.0, max_tokens: int = 2000,
         json_mode: bool = True, retries: int = 4, timeout: int = 180) -> tuple[str, dict]:
    """Return (content, usage). Retries on transient errors with backoff."""
    body = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = json.dumps(body).encode("utf-8")
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(
            cfg["base_url"] + "/chat/completions",
            data=data,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['api_key']}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            return out["choices"][0]["message"]["content"] or "", out.get("usage", {})
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:300]!r}"
            if e.code == 400 and json_mode:
                # endpoint may not support response_format; retry without it
                body.pop("response_format", None)
                data = json.dumps(body).encode("utf-8")
                json_mode = False
                continue
            if e.code in (401, 403):
                raise LLMError(last)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = repr(e)
        time.sleep(2 ** attempt)
    raise LLMError(last or "unknown error")
