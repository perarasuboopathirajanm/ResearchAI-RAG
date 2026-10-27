/*
 * ResearchAI - Neural RAG Research Assistant
 * Copyright (c) 2026 Perarasu Boopathirajan. All rights reserved.
 * Author: Perarasu Boopathirajan
 * Unauthorized copying, redistribution or claiming authorship of this file,
 * via any medium, is prohibited without written permission. See LICENSE.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  MessageSquare,
  FileText,
  Send,
  Loader2,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Info,
  ChevronDown,
  BookOpen,
  Cpu,
  Layers,
  Zap,
  ShieldCheck,
} from 'lucide-react';

const AUTHOR = 'Perarasu Boopathirajan';
const COPYRIGHT_YEAR = 2026;

const API_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : 'http://localhost:8000/api';

// Pull a readable error out of a FastAPI response
const readError = async (res, fallback) => {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) return data.detail.map((d) => d.msg).join(', ');
  } catch (_) { /* not JSON */ }
  return `${fallback} (HTTP ${res.status})`;
};

const renderInline = (content) =>
  content.split(/(\*\*.*?\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );

// Groups consecutive bullet lines into a real <ul> (bare <li> elements were invalid HTML)
const renderFormattedText = (text) => {
  if (!text) return null;
  const out = [];
  let bullets = [];
  const flush = (key) => {
    if (bullets.length) {
      out.push(<ul key={`ul-${key}`} className="list-disc ml-5 my-1 space-y-1 text-slate-600">{bullets}</ul>);
      bullets = [];
    }
  };

  text.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('- ') || t.startsWith('* ')) {
      bullets.push(<li key={idx}>{renderInline(t.substring(2))}</li>);
      return;
    }
    flush(idx);
    if (t.startsWith('### ')) out.push(<h5 key={idx} className="text-sm font-semibold text-slate-700 mt-2 mb-1">{renderInline(t.slice(4))}</h5>);
    else if (t.startsWith('## ')) out.push(<h4 key={idx} className="text-base font-semibold text-slate-700 mt-2 mb-1">{renderInline(t.slice(3))}</h4>);
    else if (t.startsWith('# ')) out.push(<h3 key={idx} className="text-lg font-bold text-indigo-500 mt-3 mb-1">{renderInline(t.slice(2))}</h3>);
    else if (t === '') out.push(<div key={idx} className="h-2" />);
    else out.push(<p key={idx} className="my-1 leading-relaxed text-slate-600">{renderInline(line)}</p>);
  });
  flush('end');
  return out;
};

const TOAST_STYLES = {
  success: { icon: CheckCircle2, color: 'text-emerald-500' },
  error: { icon: AlertCircle, color: 'text-rose-500' },
  info: { icon: Info, color: 'text-indigo-500' },
};

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [backendUp, setBackendUp] = useState(null);
  const [llmInfo, setLlmInfo] = useState(null);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hello! I am ResearchAI, an AI Research Assistant built by ' + AUTHOR + ', powered by Neural RAG. Upload your research papers, PDFs, or documents, and ask me anything about them.',
    },
  ]);
  const [query, setQuery] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);

  const messagesEndRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    fetchDocuments();
    fetchHealth();
    return () => clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isQuerying]);

  const showToast = (message, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${API_URL}/documents`);
      if (!res.ok) throw new Error(await readError(res, 'Could not load documents'));
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setBackendUp(true);
    } catch (error) {
      console.error('Failed to fetch documents', error);
      setBackendUp(false);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) setLlmInfo((await res.json()).llm || null);
    } catch (_) { /* reported via backendUp */ }
  };

  const handleUpload = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readError(res, 'Upload failed'));
      const data = await res.json();
      showToast(`Indexed ${file.name} (${data.stats?.chunks ?? 0} vector chunks)`, 'success');
      fetchDocuments();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Error uploading file. Check connection.', 'error');
    } finally {
      setIsUploading(false);
      input.value = '';
    }
  };

  const handleDelete = async (docId, filename) => {
    try {
      const res = await fetch(`${API_URL}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res, 'Delete failed'));
      showToast(`Removed ${filename || 'document'} from vector index`, 'info');
      fetchDocuments();
    } catch (error) {
      console.error('Delete failed', error);
      showToast(error.message || 'Delete failed', 'error');
    }
  };

  const sendQuery = async (queryText) => {
    const text = queryText.trim();
    if (!text || isQuerying) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setQuery('');
    setIsQuerying(true);

    try {
      const res = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, top_k: 4 }),
      });
      if (!res.ok) throw new Error(await readError(res, 'The RAG engine returned an error'));
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources || [], latency: data.latency },
      ]);
    } catch (error) {
      console.error('Query failed', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          isError: true,
          content:
            error instanceof TypeError
              ? 'I could not reach the ResearchAI backend. Please make sure the backend server is running on port 8000.'
              : `Sorry, something went wrong: ${error.message}`,
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    sendQuery(query);
  };

  const quickPrompts = [
    'Summarize the main findings',
    'What are the key technical features?',
    'Explain the core research methodology',
  ];
  const hasUserMessages = messages.some((m) => m.role === 'user');

  const NavButton = ({ tab, icon: Icon, label, badge }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`neu-btn w-full flex items-center justify-between px-4 py-3 text-sm font-medium ${
        activeTab === tab ? 'is-active text-indigo-500' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      <span className="flex items-center gap-3">
        <Icon size={18} />
        {label}
      </span>
      {badge !== undefined ? (
        <span className="neu-inset-sm px-2.5 py-0.5 text-xs font-mono text-slate-500">{badge}</span>
      ) : (
        activeTab === tab && <span className="h-2 w-2 rounded-full bg-indigo-500" />
      )}
    </button>
  );

  const ToastIcon = toast ? (TOAST_STYLES[toast.type] || TOAST_STYLES.info).icon : null;

  return (
    <div className="min-h-screen md:h-screen bg-neu-bg text-slate-600 flex flex-col md:flex-row font-sans selection:bg-indigo-200">
      {/* Toast */}
      {toast && (
        <div className="neu-sm animate-toast fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 max-w-sm">
          <ToastIcon size={18} className={(TOAST_STYLES[toast.type] || TOAST_STYLES.info).color} />
          <span className="text-sm font-medium text-slate-600">{toast.message}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-full md:w-72 shrink-0 p-5 md:p-6 flex flex-col justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-8 px-1">
            <div className="neu-sm h-12 w-12 flex items-center justify-center text-indigo-500">
              <Sparkles size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-700 tracking-wide">ResearchAI</h1>
              <p className="text-[11px] text-slate-400 font-medium">Neural RAG Engine</p>
            </div>
          </div>

          <nav className="space-y-4">
            <NavButton tab="chat" icon={MessageSquare} label="Research Chat" />
            <NavButton tab="docs" icon={FileText} label="Documents" badge={documents.length} />
          </nav>
        </div>

        <div className="neu p-4 space-y-3">
          <div
            className={`flex items-center gap-2 text-xs font-semibold ${
              backendUp === false ? 'text-rose-500' : 'text-emerald-500'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {backendUp !== false && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${backendUp === false ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            </span>
            {backendUp === false ? 'Backend Offline' : 'Neural RAG Engine Active'}
          </div>
          {[
            [Cpu, 'Embedding', 'FastEmbed ONNX'],
            [Layers, 'Vector DB', 'ChromaDB'],
            [Zap, 'Answer Model', llmInfo ? llmInfo.model.split(' · ').pop() : '—'],
          ].map(([Icon, label, value]) => (
            <div key={label} className="text-[11px] text-slate-500 flex justify-between items-center">
              <span className="flex items-center gap-1.5"><Icon size={12} /> {label}</span>
              <span className="neu-inset-sm font-mono text-[10px] text-indigo-500 px-2 py-0.5">{value}</span>
            </div>
          ))}
          {llmInfo && (
            <div
              className={`neu-inset-sm flex items-start gap-2 px-2.5 py-2 text-[10px] leading-snug ${
                llmInfo.provider === 'local'
                  ? llmInfo.reachable && llmInfo.model_ready ? 'text-emerald-600' : 'text-amber-600'
                  : 'text-slate-500'
              }`}
            >
              <ShieldCheck size={13} className="shrink-0 mt-px" />
              <span>
                {llmInfo.provider !== 'local'
                  ? 'Cloud model: questions are sent to an external API.'
                  : !llmInfo.reachable
                  ? 'Private mode: start Ollama to enable answers.'
                  : !llmInfo.model_ready
                  ? 'Private mode: model not downloaded yet (ollama pull).'
                  : 'Private mode: all data stays on this computer.'}
              </span>
            </div>
          )}
          <div className="pt-3 mt-1 border-t border-slate-300/50 text-[11px] text-slate-400 leading-relaxed">
            Built by <span className="font-semibold text-indigo-500">{AUTHOR}</span>
            <br />© {COPYRIGHT_YEAR} {AUTHOR}. All rights reserved.
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-0 md:h-screen overflow-hidden">
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 max-w-5xl mx-auto w-full">
            <div className="flex items-center justify-between mb-5 px-1">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <BookOpen size={14} className="text-indigo-500" />
                <span>
                  Knowledge Context: <strong className="text-slate-700">{documents.length} document(s) loaded</strong>
                </span>
              </div>
              <button
                onClick={() => setActiveTab('docs')}
                className="neu-btn text-xs text-indigo-500 font-semibold px-3 py-1.5"
              >
                + Manage Files
              </button>
            </div>

            <div className="neu flex-1 flex flex-col min-h-[60vh] md:min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 md:p-7 custom-scrollbar space-y-6">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[88%] p-4 md:p-5 text-sm ${
                        msg.role === 'user'
                          ? 'neu-primary rounded-3xl rounded-br-md'
                          : `neu-sm rounded-3xl rounded-bl-md ${msg.isError ? 'ring-1 ring-rose-300' : ''}`
                      }`}
                    >
                      <div>{msg.role === 'assistant' ? renderFormattedText(msg.content) : msg.content}</div>

                      {msg.role === 'assistant' && msg.sources?.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-300/50 space-y-2.5">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            Retrieved Context Sources ({msg.sources.length})
                          </div>
                          {msg.sources.map((source, sIdx) => {
                            const score = Number(source.score) || 0;
                            const isHigh = score > 0.75;
                            return (
                              <details key={sIdx} className="neu-inset text-xs overflow-hidden group">
                                <summary className="px-3 py-2.5 cursor-pointer font-medium text-slate-600 flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-2 min-w-0">
                                    <ChevronDown size={13} className="text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
                                    <FileText size={13} className="text-indigo-400 shrink-0" />
                                    <span className="truncate">{source.source}</span>
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    <span className="hidden sm:block w-16 h-1.5 rounded-full neu-inset-sm overflow-hidden">
                                      <span
                                        className={`block h-full rounded-full ${isHigh ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                                        style={{ width: `${Math.round(score * 100)}%` }}
                                      />
                                    </span>
                                    <span className={`font-mono text-[10px] ${isHigh ? 'text-emerald-500' : 'text-indigo-500'}`}>
                                      {(score * 100).toFixed(1)}%
                                    </span>
                                  </span>
                                </summary>
                                <div className="px-3 pb-3 pt-1 text-[11px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap">
                                  {source.text}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      )}

                      {msg.role === 'assistant' && typeof msg.latency === 'number' && (
                        <div className="mt-2 text-[10px] font-mono text-slate-400 text-right">
                          Response generated in {msg.latency.toFixed(2)}s
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isQuerying && (
                  <div className="flex justify-start">
                    <div className="neu-sm rounded-3xl rounded-bl-md p-4 flex items-center gap-3 text-slate-500">
                      <Loader2 size={18} className="animate-spin text-indigo-500" />
                      <span className="text-xs font-medium tracking-wide">Synthesizing response from neural index...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {documents.length > 0 && !hasUserMessages && (
                <div className="px-5 pt-1 pb-3 flex gap-3 overflow-x-auto custom-scrollbar">
                  {quickPrompts.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendQuery(p)}
                      disabled={isQuerying}
                      className="neu-btn text-xs whitespace-nowrap text-slate-500 hover:text-indigo-500 px-4 py-2 rounded-full my-2"
                    >
                      <Sparkles size={12} className="inline mr-1.5 -mt-0.5 text-indigo-400" />
                      {p}
                    </button>
                  ))}
                </div>
              )}

              <div className="p-4 md:p-5 pt-2">
                <form onSubmit={handleFormSubmit} className="flex gap-3">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a question about your research papers..."
                    className="neu-input flex-1 px-5 py-3.5 text-sm text-slate-700 placeholder-slate-400"
                  />
                  <button
                    type="submit"
                    disabled={isQuerying || !query.trim()}
                    aria-label="Send"
                    className="neu-primary px-5 flex items-center justify-center"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full overflow-y-auto custom-scrollbar">
            <div className="mb-8 px-1">
              <h2 className="text-2xl font-bold text-slate-700">Document Library</h2>
              <p className="text-xs text-slate-400 mt-1">Manage papers and vector indexes available for RAG search</p>
            </div>

            <div className="neu p-8 md:p-10 mb-10 text-center flex flex-col items-center">
              <div className="neu-inset h-16 w-16 flex items-center justify-center text-indigo-500 mb-5 rounded-2xl">
                <Upload size={28} />
              </div>
              <h3 className="text-base font-semibold text-slate-700 mb-1">Upload Research Papers</h3>
              <p className="text-slate-400 text-xs mb-7 max-w-md leading-relaxed">
                Supported formats: PDF, DOCX, TXT. Papers are split into vector embeddings using FastEmbed ONNX and stored locally.
              </p>
              <input
                type="file"
                id="file-upload"
                className="hidden"
                accept=".pdf,.txt,.docx"
                onChange={handleUpload}
                disabled={isUploading}
              />
              <label
                htmlFor="file-upload"
                className={`neu-primary px-6 py-3 flex items-center gap-2 text-sm font-semibold ${
                  isUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Processing Vectors...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Select File to Index
                  </>
                )}
              </label>
            </div>

            <h3 className="text-lg font-bold text-slate-700 mb-5 px-1 flex items-center gap-3">
              Indexed Papers
              <span className="neu-inset-sm text-xs font-mono font-normal text-slate-500 px-2.5 py-0.5">{documents.length}</span>
            </h3>

            {documents.length === 0 ? (
              <div className="neu-inset text-slate-400 text-center py-12 text-sm rounded-3xl">
                {backendUp === false
                  ? 'Cannot reach the backend. Start it with "python main.py" in the backend folder.'
                  : 'No documents currently indexed. Upload a research paper to activate RAG search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {documents.map((doc) => (
                  <div key={doc.id} className="neu-card p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="neu-inset p-3 text-indigo-500 shrink-0">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-700 truncate" title={doc.filename}>{doc.filename}</div>
                        <div className="text-[10px] text-emerald-500 font-mono mt-0.5 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Vector Indexed
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      className="neu-btn text-rose-400 hover:text-rose-500 p-2.5 shrink-0 rounded-xl"
                      title="Delete from Vector DB"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
