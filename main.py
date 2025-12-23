import json
import requests
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from fastapi.responses import StreamingResponse

import chromadb
from chromadb.config import Settings

app = FastAPI()

# Allow CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VLLM_API_URL = "http://localhost:8000/v1/chat/completions"
CHROMA_DIR = "./chroma_db"
COLLECTION_NAME = "inje_docs"
EMBEDDING_API_URL = "http://localhost:8005/v1/embeddings"
EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
THINK_START = "<think>"
THINK_END = "</think>"
ANSWER_ONLY = True
FINAL_TAG_RE = re.compile(r"<final>(.*?)</final>", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
REASONING_MARKERS = [
    "okay, the user asked",
    "i need to",
    "i should",
    "let me",
    "first,",
    "second,",
    "therefore",
    "so the answer",
    "사용자가",
    "질문",
    "먼저",
    "따라서",
    "그러므로",
    "즉,",
]
ANSWER_TAGS = ["<think>", "</think>", "<final>", "</final>"]

# --- RAG Helper Functions ---

def get_query_embedding(text: str) -> List[float]:
    """Get embedding for a query using vLLM."""
    try:
        payload = {
            "model": EMBEDDING_MODEL,
            "input": [text]
        }
        response = requests.post(EMBEDDING_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        if "data" in data and len(data["data"]) > 0:
            return data["data"][0]["embedding"]
    except Exception as e:
        print(f"Error getting embedding: {e}")
    return []

def retrieve_documents(query: str, k: int = 3) -> str:
    """Retrieve relevant documents from ChromaDB."""
    try:
        embedding = get_query_embedding(query)
        if not embedding:
            return ""

        client = chromadb.PersistentClient(path=CHROMA_DIR, settings=Settings(anonymized_telemetry=False))
        collection = client.get_or_create_collection(name=COLLECTION_NAME)
        
        results = collection.query(
            query_embeddings=[embedding],
            n_results=k
        )
        
        documents = results["documents"][0] if results["documents"] else []
        metadatas = results["metadatas"][0] if results["metadatas"] else []
        
        context_parts = []
        for i, doc in enumerate(documents):
            source = metadatas[i].get("source", "unknown") if i < len(metadatas) else "unknown"
            context_parts.append(f"[Document {i+1} (Source: {source})]:\n{doc}")
            
        return "\n\n".join(context_parts)
    except Exception as e:
        print(f"Error retrieving documents: {e}")
        return ""


def _filter_text_with_state(text: str, in_think: bool) -> tuple[str, bool]:
    if not text:
        return text, in_think

    lower = text.lower()
    out = []
    i = 0

    while i < len(text):
        if in_think:
            end = lower.find(THINK_END, i)
            if end == -1:
                return "".join(out), True
            i = end + len(THINK_END)
            in_think = False
        else:
            start = lower.find(THINK_START, i)
            if start == -1:
                out.append(text[i:])
                return "".join(out), False
            out.append(text[i:start])
            i = start + len(THINK_START)
            in_think = True

    return "".join(out), in_think

def _strip_thinking(text: str) -> str:
    if not text:
        return text
    cleaned = THINK_BLOCK_RE.sub("", text)
    filtered, _ = _filter_text_with_state(cleaned, False)
    return filtered.strip()

def _looks_like_reasoning(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in REASONING_MARKERS)

def _extract_answer_only(text: str) -> str:
    cleaned = _strip_thinking(text)
    if not cleaned or not ANSWER_ONLY:
        return cleaned
    final_match = FINAL_TAG_RE.search(cleaned)
    if final_match:
        return final_match.group(1).strip()
    code_blocks = list(CODE_FENCE_RE.finditer(cleaned))
    if code_blocks:
        return code_blocks[-1].group(0).strip()
    labeled = re.search(r"(?:^|\n)\s*(final|answer)\s*:\s*", cleaned, re.IGNORECASE)
    if labeled:
        return cleaned[labeled.end():].strip()
    blocks = [block.strip() for block in re.split(r"\n\s*\n", cleaned) if block.strip()]
    if len(blocks) >= 2:
        return blocks[-1]
    return cleaned

def _answer_only_chunk(text: str) -> str:
    chunk = {
        "object": "chat.completion.chunk",
        "choices": [
            {"delta": {"content": text}, "index": 0, "finish_reason": None}
        ],
    }
    return f"data: {json.dumps(chunk)}\n\n"

def _finish_chunk() -> str:
    chunk = {
        "object": "chat.completion.chunk",
        "choices": [
            {"delta": {}, "index": 0, "finish_reason": "stop"}
        ],
    }
    return f"data: {json.dumps(chunk)}\n\n"

def _stream_without_thinking(response: requests.Response, answer_only: bool):
    in_think = False
    buffered = []
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            continue
        if not line.startswith("data:"):
            yield f"{line}\n"
            continue

        data_str = line[5:].lstrip()
        if data_str == "[DONE]":
            if answer_only and buffered:
                final_text = _extract_answer_only("".join(buffered))
                if final_text:
                    yield _answer_only_chunk(final_text)
                    yield _finish_chunk()
            yield "data: [DONE]\n\n"
            return

        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            yield f"{line}\n"
            continue

        for choice in data.get("choices", []):
            delta = choice.get("delta")
            if isinstance(delta, dict):
                if "reasoning_content" in delta:
                    delta.pop("reasoning_content", None)
                if "content" in delta:
                    filtered, in_think = _filter_text_with_state(delta["content"], in_think)
                    delta["content"] = filtered
                    if answer_only:
                        buffered.append(filtered)

            message = choice.get("message")
            if isinstance(message, dict):
                if "reasoning_content" in message:
                    message.pop("reasoning_content", None)
                if "content" in message:
                    filtered, in_think = _filter_text_with_state(message["content"], in_think)
                    message["content"] = filtered
                    if answer_only:
                        buffered.append(filtered)

        if not answer_only:
            yield f"data: {json.dumps(data)}\n\n"

def _stream_answer_text(text: str, chunk_size: int = 24):
    if not text:
        yield _answer_only_chunk("")
        yield _finish_chunk()
        yield "data: [DONE]\n\n"
        return

    for i in range(0, len(text), chunk_size):
        yield _answer_only_chunk(text[i:i + chunk_size])
    yield _finish_chunk()
    yield "data: [DONE]\n\n"

def _filter_answer_stream(text: str, state: dict) -> str:
    if not text:
        return ""
    data = state["pending"] + text
    lower = data.lower()
    out = []
    i = 0
    while i < len(data):
        if data[i] == "<":
            matched = False
            for tag in ANSWER_TAGS:
                if lower.startswith(tag, i):
                    matched = True
                    if tag == "<think>":
                        state["in_think"] = True
                    elif tag == "</think>":
                        state["in_think"] = False
                    elif tag == "<final>":
                        state["in_final"] = True
                    elif tag == "</final>":
                        state["in_final"] = False
                    i += len(tag)
                    break
            if matched:
                continue
            remainder = lower[i:]
            if any(tag.startswith(remainder) for tag in ANSWER_TAGS):
                state["pending"] = data[i:]
                break
        if not state["in_think"]:  # Output everything not in <think> block
            out.append(data[i])
        i += 1
    else:
        state["pending"] = ""
    return "".join(out)

def _stream_answer_only_from_vllm(response: requests.Response):
    state = {"in_final": False, "in_think": False, "pending": ""}
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            continue
        if not line.startswith("data:"):
            yield f"{line}\n"
            continue

        data_str = line[5:].lstrip()
        if data_str == "[DONE]":
            yield _finish_chunk()
            yield "data: [DONE]\n\n"
            return

        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            continue

        for choice in data.get("choices", []):
            delta = choice.get("delta")
            if isinstance(delta, dict):
                delta.pop("reasoning_content", None)
                text = delta.get("content")
                if isinstance(text, str):
                    filtered = _filter_answer_stream(text, state)
                    if filtered:
                        yield _answer_only_chunk(filtered)

            message = choice.get("message")
            if isinstance(message, dict):
                message.pop("reasoning_content", None)
                text = message.get("content")
                if isinstance(text, str):
                    filtered = _filter_answer_stream(text, state)
                    if filtered:
                        yield _answer_only_chunk(filtered)

class Message(BaseModel):
    role: str
    content: str
    id: Optional[str] = None

class ChatRequest(BaseModel):
    messages: List[Message]
    stream: bool = True
    answer_only: bool = True

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    # Prepare payload for vLLM
    
    # 1. Extract latest user message
    messages = request.messages
    latest_user_content = ""
    for msg in reversed(messages):
        if msg.role == "user":
            latest_user_content = msg.content
            break
            
    # 2. Retrieve Context (RAG)
    context = ""
    if latest_user_content:
        print(f"Retrieving context for: {latest_user_content[:50]}...")
        context = retrieve_documents(latest_user_content)
        if context:
            print("Context retrieved.")
    
    # 3. Construct Augmented Prompt
    # We will modify the last user message to include context
    vllm_messages = [{"role": m.role, "content": m.content} for m in messages]
    
    if context and vllm_messages:
        # Find the last user message in the list to append context
        for i in range(len(vllm_messages) - 1, -1, -1):
            if vllm_messages[i]["role"] == "user":
                original_content = vllm_messages[i]["content"]
                augmented_content = f"""Use the following context to answer the user's question. If the context is not relevant to the question, ignore it and answer based on your internal knowledge.

Context:
{context}

Question:
{original_content}
"""
                vllm_messages[i]["content"] = augmented_content
                break

    payload = {
        "model": "Qwen/Qwen3-8B",  # Adjust model name if needed
        "messages": vllm_messages,
        "stream": request.stream,
        "temperature": 0.7,
        "max_tokens": 8192
    }

    # Fetch available models to ensure we use the correct model name
    try:
        models_resp = requests.get("http://localhost:8000/v1/models")
        if models_resp.status_code == 200:
            models_data = models_resp.json()
            if models_data.get("data"):
                # Use the first available model
                payload["model"] = models_data["data"][0]["id"]
    except Exception as e:
        print(f"Warning: Could not fetch models from vLLM: {e}")

    try:
        response = requests.post(VLLM_API_URL, json=payload, stream=request.stream)
        response.raise_for_status()

        if request.stream:
            if request.answer_only:
                return StreamingResponse(
                    _stream_answer_only_from_vllm(response),
                    media_type="text/event-stream"
                )
            return StreamingResponse(
                _stream_without_thinking(response, answer_only=request.answer_only),
                media_type="text/event-stream"
            )
        else:
            data = response.json()
            for choice in data.get("choices", []):
                message = choice.get("message")
                if message and "content" in message:
                    message["content"] = _extract_answer_only(message["content"]) if request.answer_only else _strip_thinking(message["content"])
                if message and "reasoning_content" in message:
                    message.pop("reasoning_content", None)
                if "text" in choice:
                    choice["text"] = _extract_answer_only(choice["text"]) if request.answer_only else _strip_thinking(choice["text"])
                if "reasoning_content" in choice:
                    choice.pop("reasoning_content", None)
            return data

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
