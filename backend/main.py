# =============================================================================
#  ResearchAI - Neural RAG Research Assistant
#  Copyright (c) 2026 Perarasu Boopathirajan. All rights reserved.
#  Author: Perarasu Boopathirajan
#  Unauthorized copying, redistribution or claiming authorship of this file,
#  via any medium, is prohibited without written permission. See LICENSE.
# =============================================================================
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import os
import time
import uuid
import shutil
import traceback
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

from rag_engine import RAGEngine  # noqa: E402  (load .env before the engine reads it)
from llm_client import LLMError  # noqa: E402

AUTHOR = "Perarasu Boopathirajan"

app = FastAPI(
    title="ResearchAI - AI Research Assistant API",
    description=f"Neural RAG research assistant. Created by {AUTHOR}. (c) 2026 {AUTHOR}, all rights reserved.",
    version="1.1.0",
    contact={"name": AUTHOR},
    license_info={"name": f"Proprietary - (c) 2026 {AUTHOR}"},
)


@app.middleware("http")
async def add_author_header(request, call_next):
    response = await call_next(request)
    response.headers["X-Author"] = AUTHOR
    response.headers["X-Copyright"] = f"(c) 2026 {AUTHOR}"
    return response

app.add_middleware(
    CORSMiddleware,
    # Only the local frontend may call this API (override with ALLOWED_ORIGINS in .env)
    allow_origins=[o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Author", "X-Copyright"],
)

rag_engine = RAGEngine()

ALLOWED_EXTENSIONS = {"pdf", "txt", "docx"}
TEMP_DIR = os.path.join(BASE_DIR, "temp_uploads")


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(4, ge=1, le=20)


# Plain `def` endpoints run in FastAPI's thread pool, so slow embedding /
# LLM calls no longer block the whole server.
@app.post("/api/upload")
def upload_document(file: UploadFile = File(...)):
    # Strip any directory parts from the client-supplied name (path traversal fix)
    filename = os.path.basename((file.filename or "").replace("\\", "/")).strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Missing file name.")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '.{ext}'. Use PDF, DOCX or TXT.")

    os.makedirs(TEMP_DIR, exist_ok=True)
    file_path = os.path.join(TEMP_DIR, f"{uuid.uuid4().hex}.{ext}")
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        stats = rag_engine.process_document(file_path, filename)
        if stats.get("chunks", 0) == 0:
            raise HTTPException(
                status_code=422,
                detail=f"No readable text found in {filename} (it may be a scanned/image-only PDF).",
            )
        return {"status": "success", "message": f"Processed {filename}", "stats": stats}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always clean up, even when processing fails
        if os.path.exists(file_path):
            os.remove(file_path)


@app.get("/api/documents")
def get_documents():
    return {"documents": rag_engine.get_documents()}


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    rag_engine.delete_document(doc_id)
    return {"status": "success", "message": f"Deleted document {doc_id}"}


@app.post("/api/query")
def query_assistant(request: QueryRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    try:
        start_time = time.time()
        result = rag_engine.query(request.query.strip(), request.top_k)
        result["latency"] = time.time() - start_time
        return result
    except LLMError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "version": "1.1.0",
        "author": AUTHOR,
        "llm": {"provider": rag_engine.llm.provider, "model": rag_engine.llm.label, **rag_engine.llm.status()},
    }


if __name__ == "__main__":
    import uvicorn
    # 127.0.0.1 = reachable only from this computer (set HOST=0.0.0.0 to share on a network)
    uvicorn.run("main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), reload=True)
