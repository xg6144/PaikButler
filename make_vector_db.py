"""
build_chroma_from_md_vllm.py

- Reads .md files
- Chunks text
- Gets embeddings from vLLM (OpenAI-compatible /v1/embeddings)
- Stores into Chroma persistent DB

Run:
  python build_chroma_from_md_vllm.py \
    --md_dir ./markdowns \
    --chroma_dir ./chroma_db \
    --collection my_docs \
    --vllm_base_url http://127.0.0.1:8005 \
    --model Qwen/Qwen3-Embedding-0.6B
"""

import os
import re
import glob
import argparse
from typing import List, Dict, Any

import requests
from tqdm import tqdm

import chromadb
from chromadb.config import Settings


# -----------------------------
# Markdown reading & chunking
# -----------------------------
def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def clean_md(md: str) -> str:
    md = md.replace("\r\n", "\n").replace("\r", "\n")
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"[ \t]{2,}", " ", md)
    return md.strip()


def chunk_text(text: str, chunk_size: int = 1200, chunk_overlap: int = 200) -> List[str]:
    if chunk_size <= 0:
        return [text]

    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == n:
            break
        start = max(0, end - chunk_overlap)
    return chunks


# -----------------------------
# vLLM embeddings client
# -----------------------------
def vllm_embed(
    base_url: str,
    model: str,
    texts: List[str],
    batch_size: int = 64,
    timeout: int = 300,
) -> List[List[float]]:
    """
    Calls vLLM OpenAI-compatible embeddings endpoint.
    POST {base_url}/v1/embeddings
      { "model": "...", "input": ["...", "..."] }

    Returns: List[embedding_vector]
    """
    url = base_url.rstrip("/") + "/v1/embeddings"
    all_vecs: List[List[float]] = []

    for i in tqdm(range(0, len(texts), batch_size), desc="Embedding(vLLM)"):
        batch = texts[i : i + batch_size]
        payload = {"model": model, "input": batch}

        r = requests.post(url, json=payload, timeout=timeout)
        if r.status_code != 200:
            raise RuntimeError(
                f"vLLM embeddings failed: HTTP {r.status_code}\n{r.text}"
            )

        data: Dict[str, Any] = r.json()
        # OpenAI format: {"data":[{"embedding":[...], "index":0}, ...]}
        vecs = [item["embedding"] for item in data["data"]]
        all_vecs.extend(vecs)

    return all_vecs


# -----------------------------
# Chroma build
# -----------------------------
def ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)


def build_chroma(
    md_dir: str,
    chroma_dir: str,
    collection_name: str,
    vllm_base_url: str,
    model: str,
    chunk_size: int = 1200,
    chunk_overlap: int = 200,
    embed_batch_size: int = 64,
):
    md_paths = sorted(glob.glob(os.path.join(md_dir, "**", "*.md"), recursive=True))
    if not md_paths:
        raise FileNotFoundError(f"No .md files found under: {md_dir}")

    ids: List[str] = []
    docs: List[str] = []
    metadatas: List[Dict[str, Any]] = []

    for path in md_paths:
        raw = read_text(path)
        text = clean_md(raw)
        chunks = chunk_text(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

        rel = os.path.relpath(path, md_dir)
        for j, ch in enumerate(chunks):
            doc_id = f"{rel}::chunk{j}"
            ids.append(doc_id)
            docs.append(ch)
            metadatas.append({"source": rel, "chunk": j})

    # Embed via vLLM
    embeddings = vllm_embed(
        base_url=vllm_base_url,
        model=model,
        texts=docs,
        batch_size=embed_batch_size,
    )

    ensure_dir(chroma_dir)
    client = chromadb.PersistentClient(
        path=chroma_dir,
        settings=Settings(anonymized_telemetry=False),
    )
    collection = client.get_or_create_collection(name=collection_name)

    # Insert in batches
    bs = 256
    for i in tqdm(range(0, len(ids), bs), desc="Writing to Chroma"):
        collection.add(
            ids=ids[i : i + bs],
            documents=docs[i : i + bs],
            embeddings=embeddings[i : i + bs],
            metadatas=metadatas[i : i + bs],
        )

    print("\n✅ Done!")
    print(f"- Markdown dir : {md_dir}")
    print(f"- Chroma path  : {chroma_dir}")
    print(f"- Collection  : {collection_name}")
    print(f"- #Chunks     : {len(ids)}")
    print(f"- vLLM        : {vllm_base_url}")
    print(f"- model       : {model}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md_dir", type=str, required=True)
    ap.add_argument("--chroma_dir", type=str, required=True)
    ap.add_argument("--collection", type=str, default="docs")
    ap.add_argument("--vllm_base_url", type=str, default="http://127.0.0.1:8005")
    ap.add_argument("--model", type=str, default="Qwen/Qwen3-Embedding-0.6B")
    ap.add_argument("--chunk_size", type=int, default=1200)
    ap.add_argument("--chunk_overlap", type=int, default=200)
    ap.add_argument("--embed_batch_size", type=int, default=64)
    args = ap.parse_args()

    build_chroma(
        md_dir=args.md_dir,
        chroma_dir=args.chroma_dir,
        collection_name=args.collection,
        vllm_base_url=args.vllm_base_url,
        model=args.model,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        embed_batch_size=args.embed_batch_size,
    )


if __name__ == "__main__":
    main()