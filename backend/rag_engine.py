# =============================================================================
#  ResearchAI - Neural RAG Research Assistant
#  Copyright (c) 2026 Perarasu Boopathirajan. All rights reserved.
#  Author: Perarasu Boopathirajan
#  Unauthorized copying, redistribution or claiming authorship of this file,
#  via any medium, is prohibited without written permission. See LICENSE.
# =============================================================================
import os
import uuid
from typing import List, Dict, Any
from llm_client import create_llm
import chromadb
import pypdf
import docx

# Try FastEmbed (ONNX runtime - Low CPU/RAM, No GPU required) with SentenceTransformers fallback
try:
    from fastembed import TextEmbedding
    USE_FASTEMBED = True
except ImportError:
    from sentence_transformers import SentenceTransformer
    USE_FASTEMBED = False

class RAGEngine:
    def __init__(self):
        # Answer generator: self-hosted local model by default (see llm_client.py)
        self.llm = create_llm()
        print(f"Answer model: {self.llm.label}")
        
        # Initialize Embedding model (Fast ONNX CPU / Zero GPU)
        if USE_FASTEMBED:
            print("Loading FastEmbed ONNX embedding model (Low RAM, High Speed CPU)...")
            self.embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
        else:
            model_name = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
            print(f"Loading embedding model: {model_name}...")
            self.embedding_model = SentenceTransformer(model_name)
        
        # Initialize ChromaDB Vector Store
        from chromadb.config import Settings
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
        self.chroma_client = chromadb.PersistentClient(
            path=db_path,
            settings=Settings(anonymized_telemetry=False)
        )
        self.collection = self.chroma_client.get_or_create_collection(
            name="research_papers",
            metadata={"hnsw:space": "cosine"}
        )
        print("RAG Engine initialized successfully.")

    def _extract_text(self, file_path: str, filename: str) -> str:
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

        text = ""
        if ext == 'pdf':
            with open(file_path, 'rb') as f:
                reader = pypdf.PdfReader(f)
                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        elif ext == 'txt':
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
        elif ext == 'docx':
            doc = docx.Document(file_path)
            for para in doc.paragraphs:
                text += para.text + "\n"
        else:
            raise ValueError(f"Unsupported file format: {ext}")
        return text

    def _chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        if not text or not text.strip():
            return []
            
        clean_text = text.strip()
        if len(clean_text) <= chunk_size:
            return [clean_text] if len(clean_text) > 20 else []

        chunks = []
        start = 0
        while start < len(clean_text):
            end = min(start + chunk_size, len(clean_text))
            
            if end < len(clean_text):
                last_period = clean_text.rfind('.', start, end)
                if last_period != -1 and last_period > start + chunk_size // 2:
                    end = last_period + 1
            
            chunk = clean_text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            if end >= len(clean_text):
                break
                
            start = max(start + 1, end - overlap)
            
        return [c for c in chunks if len(c) > 20]

    def process_document(self, file_path: str, filename: str) -> Dict[str, Any]:
        text = self._extract_text(file_path, filename)
        chunks = self._chunk_text(text)
        
        if not chunks:
            return {"chunks": 0}
            
        if USE_FASTEMBED:
            embeddings = [e.tolist() for e in self.embedding_model.embed(chunks)]
        else:
            embeddings = self.embedding_model.encode(chunks).tolist()
        
        doc_id = str(uuid.uuid4())
        ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
        metadatas = [{"source": filename, "chunk_index": i, "doc_id": doc_id} for i in range(len(chunks))]
        
        self.collection.add(
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
            ids=ids
        )
        return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks)}

    def get_documents(self) -> List[Dict[str, str]]:
        # A simple hack to get unique documents from the collection
        result = self.collection.get(include=["metadatas"])
        docs = {}
        if result and "metadatas" in result and result["metadatas"]:
            for meta in result["metadatas"]:
                if meta and "doc_id" in meta:
                    docs[meta["doc_id"]] = meta["source"]
        
        return [{"id": k, "filename": v} for k, v in docs.items()]

    def delete_document(self, doc_id: str):
        # We need to query by metadata in ChromaDB 
        self.collection.delete(where={"doc_id": doc_id})

    def query(self, user_query: str, top_k: int = 4) -> Dict[str, Any]:
        if self.collection.count() == 0:
            return {
                "answer": "No documents have been uploaded yet. Please upload some research papers first.",
                "sources": []
            }
            
        # Get query embedding
        if USE_FASTEMBED:
            query_embedding = [e.tolist() for e in self.embedding_model.embed([user_query])][0]
        else:
            query_embedding = self.embedding_model.encode([user_query]).tolist()[0]
        
        # Search vector DB (never ask for more results than exist)
        n_results = max(1, min(top_k, self.collection.count()))
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        
        sources = []
        context_text = ""
        
        if results and results.get('documents') and len(results['documents']) > 0:
            docs = results['documents'][0]
            metas = results['metadatas'][0]
            distances = (results.get('distances') or [[]])[0] or []
            
            for i in range(len(docs)):
                doc_text = docs[i]
                meta = metas[i]
                dist = distances[i] if i < len(distances) else None
                
                context_text += f"---\nSource: {meta['source']}\n{doc_text}\n"
                sources.append({
                    "text": doc_text,
                    "source": meta["source"],
                    # Chroma cosine distance = 1 - cosine similarity, so similarity = 1 - distance.
                    # (Old code returned 0% for a perfect match because dist == 0 is falsy.)
                    "score": max(0.0, min(1.0, 1.0 - dist)) if dist is not None else 0.0
                })
        
        system_prompt = f"""You are an advanced AI Research Assistant. Your goal is to provide clear, helpful, and accurate answers based on the retrieved research paper context below.
- If the user asks a general question (e.g. asking for details, summaries, or overview of the project/paper), summarize the key points from the provided context in a well-structured way.
- Use inline citations like [Source: filename] where relevant.
- If the context does not contain the answer, say so plainly instead of guessing.
- Be clear, professional, and friendly.

Context:
{context_text}
"""
        
        # Generate the answer (local model by default - nothing leaves this machine)
        answer = self.llm.chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query},
            ],
            temperature=0.3,
            max_tokens=2048,
        )
        if not answer:
            answer = "The model returned an empty response. Please try rephrasing your question."
        
        return {
            "answer": answer,
            "sources": sources,
            "model": self.llm.label,
        }
