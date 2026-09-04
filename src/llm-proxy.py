#!/usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later
"""Stream an OpenAI-compatible completion through Cockpit's host channel.

This is a transport adapter for custom endpoints. It is not a credential or
authorization boundary: the caller is already an authorized Cockpit user.
"""

import json
import sys
import urllib.error
import urllib.request

REQUEST_TIMEOUT = 120


def emit(event):
    print(json.dumps(event, ensure_ascii=False, separators=(",", ":")), flush=True)


def endpoint_for(base_url):
    if not isinstance(base_url, str) or not base_url:
        raise ValueError("A custom LLM base URL is required")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("The custom LLM URL must use HTTP or HTTPS")
    endpoint = base_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint += "/chat/completions"
    return endpoint


def emit_choice(choice):
    delta = choice.get("delta") or choice.get("message") or {}
    content = delta.get("content")
    if isinstance(content, str) and content:
        emit({"type": "delta", "content": content})

    for default_index, tool_call in enumerate(delta.get("tool_calls", [])):
        function = tool_call.get("function") or {}
        event = {
            "type": "tool_call",
            "index": tool_call.get("index", default_index),
        }
        if tool_call.get("id"):
            event["id"] = tool_call["id"]
        if function.get("name"):
            event["name"] = function["name"]
        if function.get("arguments"):
            event["arguments"] = function["arguments"]
        if tool_call.get("extra_content"):
            event["extra_content"] = tool_call["extra_content"]
        emit(event)


def emit_response(response):
    if response.get("error"):
        raise RuntimeError(str(response["error"]))
    for choice in response.get("choices", []):
        emit_choice(choice)


def stream_response(response):
    event_data = []
    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
        if line.startswith("data:"):
            event_data.append(line[5:].lstrip())
        elif not line and event_data:
            data = "\n".join(event_data)
            event_data = []
            if data == "[DONE]":
                return
            emit_response(json.loads(data))

    if event_data:
        data = "\n".join(event_data)
        if data != "[DONE]":
            emit_response(json.loads(data))


def main():
    request = json.load(sys.stdin)
    endpoint = endpoint_for(request.get("base_url"))
    payload = {
        "model": request.get("model", ""),
        "messages": request.get("messages", []),
        "tools": request.get("tools", []),
        "stream": True,
    }
    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    if request.get("api_key"):
        headers["Authorization"] = f"Bearer {request['api_key']}"

    http_request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_request, timeout=REQUEST_TIMEOUT) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text/event-stream" in content_type:
                stream_response(response)
            else:
                emit_response(json.load(response))
    except urllib.error.HTTPError as error:
        body = error.read(8192).decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM endpoint returned HTTP {error.code}: {body}") from error

    emit({"type": "done"})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "error": str(error)})
        sys.exit(1)
