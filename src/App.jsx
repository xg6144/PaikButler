import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Chat from "./components/Chat.jsx";
import { BrandMark } from "./components/BrandMark.jsx";
import LoginModal from "./components/LoginModal.jsx";

function Icon({ path, size = 18, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"}>
      {title ? <title>{title}</title> : null}
      <path d={path} fill="currentColor" />
    </svg>
  );
}

const INITIAL_THREADS = [
  { id: "t1", section: "Today", title: "안녕 인사 및 도움 요청 대화", summaryLocked: true },
  { id: "t2", section: "2025-03", title: "저녁 메뉴 추천 다양한 음식 선택", summaryLocked: true },
];

const INITIAL_THREAD_MESSAGES = {
  t1: [],
  t2: [],
};

const STORAGE_KEY = "inje-chat-state-v1";

function loadStoredState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;

    const threads = Array.isArray(data.threads) && data.threads.length > 0 ? data.threads : null;
    const threadMessages = data.threadMessages && typeof data.threadMessages === "object" ? data.threadMessages : null;
    const activeThreadId = typeof data.activeThreadId === "string" ? data.activeThreadId : null;

    const normalizedMessages = {};
    if (threadMessages) {
      for (const [threadId, messages] of Object.entries(threadMessages)) {
        if (Array.isArray(messages)) {
          normalizedMessages[threadId] = messages;
        }
      }
    }

    if (threads) {
      for (const thread of threads) {
        if (thread?.id && !Array.isArray(normalizedMessages[thread.id])) {
          normalizedMessages[thread.id] = [];
        }
      }
    }

    return {
      threads,
      threadMessages: normalizedMessages,
      activeThreadId,
    };
  } catch {
    return null;
  }
}

function getInitialState() {
  const stored = loadStoredState();
  const threads = stored?.threads ?? INITIAL_THREADS;
  const threadMessages = {
    ...INITIAL_THREAD_MESSAGES,
    ...(stored?.threadMessages ?? {}),
  };

  for (const thread of threads) {
    if (!Array.isArray(threadMessages[thread.id])) {
      threadMessages[thread.id] = [];
    }
  }

  const activeThreadId =
    stored?.activeThreadId && threads.some((t) => t.id === stored.activeThreadId)
      ? stored.activeThreadId
      : threads[0]?.id ?? INITIAL_THREADS[0]?.id;

  return { threads, threadMessages, activeThreadId };
}

function persistState({ threads, threadMessages, activeThreadId }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        threads,
        threadMessages,
        activeThreadId,
      }),
    );
  } catch {
    // Storage can fail in private mode or when quota is exceeded.
  }
}

export default function App() {
  const initialState = useMemo(() => getInitialState(), []);
  // Check if mobile on initial load
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 768;
    }
    return false;
  });

  const [threads, setThreads] = useState(initialState.threads);
  const [activeThreadId, setActiveThreadId] = useState(initialState.activeThreadId);
  const [threadMessages, setThreadMessages] = useState(initialState.threadMessages);
  const [displayName] = useState("전동빈");
  const [loginOpen, setLoginOpen] = useState(false);
  const apiBase = import.meta.env.VITE_API_BASE ?? "";

  useEffect(() => {
    persistState({ threads, threadMessages, activeThreadId });
  }, [threads, threadMessages, activeThreadId]);

  // Helper to generate IDs safely (crypto.randomUUID fails in insecure contexts)
  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function handleNewChat() {
    const id = generateId();
    setThreads((prev) => [{ id, section: "Today", title: "New chat", summaryLocked: false }, ...prev]);
    setThreadMessages((prev) => ({ ...prev, [id]: [] }));
    setActiveThreadId(id);
  }

  async function handleSend(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const threadId = activeThreadId;

    const userMessage = { id: generateId(), role: "user", content: trimmed };
    const assistantId = generateId();
    const assistantMessage = {
      id: assistantId,
      role: "assistant",
      content: "생각 중...",
      pending: true,
    };

    setThreadMessages((prev) => {
      const current = prev[threadId] ?? [];
      return { ...prev, [threadId]: [...current, userMessage, assistantMessage] };
    });

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== threadId) return t;
        if (t.title !== "New chat") return t;
        return { ...t, title: trimmed.slice(0, 24) };
      }),
    );

    const history = (threadMessages[threadId] ?? []).filter((m) => !m.pending);
    const payloadMessages = [
      {
        role: "system",
        content:
          "당신은 도움이 되는 AI 어시스턴트입니다. 질문에 친절하고 정확하게 답변해주세요.",
      },
      ...[...history, userMessage].map(({ role, content }) => ({ role, content })),
    ];

    const updateAssistant = (nextContent, updates = {}) => {
      setThreadMessages((prev) => {
        const current = prev[threadId] ?? [];
        return {
          ...prev,
          [threadId]: current.map((m) => (m.id === assistantId ? { ...m, content: nextContent, ...updates } : m)),
        };
      });
    };

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages, stream: true, answer_only: true }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `요청 실패 (${response.status})`);
      }

      let assistantText = "";
      let received = false;

      if (!response.body) {
        const data = await response.json();
        assistantText =
          data?.choices?.[0]?.message?.content?.trim() ||
          data?.choices?.[0]?.text?.trim() ||
          data?.error?.message ||
          "";
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            const lines = event.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const dataStr = line.slice(5).trim();
              if (!dataStr) continue;
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              let payload;
              try {
                payload = JSON.parse(dataStr);
              } catch {
                continue;
              }
              const choices = payload?.choices ?? [];
              for (const choice of choices) {
                const deltaText = choice?.delta?.content;
                if (typeof deltaText === "string") {
                  assistantText += deltaText;
                  continue;
                }
                const messageText = choice?.message?.content;
                if (typeof messageText === "string") {
                  assistantText = messageText;
                }
              }
            }
            if (assistantText) {
              if (!received) {
                received = true;
                updateAssistant(assistantText, { pending: false });
              } else {
                updateAssistant(assistantText);
              }
            }
            if (done) break;
          }
        }
      }

      if (!assistantText) {
        assistantText = "응답이 비어 있습니다.";
      }

      if (!received) {
        updateAssistant(assistantText, { pending: false });
      }

      const threadMeta = threads.find((t) => t.id === threadId);
      const shouldSummarize = !threadMeta?.summaryLocked;

      if (shouldSummarize) {
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, summaryLocked: true } : t)));

        const summaryMessages = [
          {
            role: "system",
            content:
              "다음 대화를 8~14자 한국어 제목으로 요약하세요. 제목만 출력하고 다른 설명은 하지 마세요.",
          },
          ...[...history, userMessage, { role: "assistant", content: assistantText }].map(({ role, content }) => ({
            role,
            content,
          })),
        ];

        try {
          const summaryResponse = await fetch(`${apiBase}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: summaryMessages, stream: false, answer_only: true }),
          });

          if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            const summaryText =
              summaryData?.choices?.[0]?.message?.content?.trim() ||
              summaryData?.choices?.[0]?.text?.trim() ||
              "";

            if (summaryText) {
              setThreads((prev) =>
                prev.map((t) =>
                  t.id === threadId ? { ...t, title: summaryText.slice(0, 24), summaryLocked: true } : t,
                ),
              );
            }
          }
        } catch {
          // ignore summary errors
        }
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      setThreadMessages((prev) => {
        const current = prev[threadId] ?? [];
        return {
          ...prev,
          [threadId]: current.map((m) =>
            m.id === assistantId ? { ...m, content: `오류: ${message}`, pending: false, error: true } : m,
          ),
        };
      });
    }
  }

  const messages = threadMessages[activeThreadId] ?? [];
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const threadTitle = activeThread?.title ?? "New chat";
  return (
    <div className={`app ${sidebarCollapsed ? "appSidebarCollapsed" : ""}`}>
      {/* Mobile Backdrop */}
      <div
        className={`mobileBackdrop ${!sidebarCollapsed ? "active" : ""}`}
        onClick={() => setSidebarCollapsed(true)}
        aria-hidden="true"
      />

      <aside className="sidebar" aria-hidden={sidebarCollapsed ? "true" : undefined}>
        <Sidebar
          threads={threads}
          activeThreadId={activeThreadId}
          displayName={displayName}
          onNewChat={handleNewChat}
          onSelectThread={(id) => {
            setActiveThreadId(id);
            if (window.innerWidth < 768) setSidebarCollapsed(true); // Auto-close on mobile selection
          }}
          onCollapse={() => setSidebarCollapsed(true)}
          onLogin={() => setLoginOpen(true)}
        />
      </aside>

      <div className="collapsedControls" aria-label="사이드바 접힘 컨트롤" aria-hidden={sidebarCollapsed ? undefined : "true"}>
        {/* ... existing collapsed controls ... */}
        <div className="collapsedBrand" aria-hidden="true" onClick={handleNewChat}>
          <BrandMark size={40} />
        </div>
        <div className="collapsedPill">
          <button
            className="collapsedPillBtn"
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="사이드바 열기"
            disabled={!sidebarCollapsed}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <path d="M9 3v18" />
              <path d="m13 15 3-3-3-3" />
            </svg>
          </button>
          <div className="collapsedPillDivider" aria-hidden="true" />
          <button className="collapsedPillBtn" type="button" onClick={handleNewChat} aria-label="새 채팅" disabled={!sidebarCollapsed}>
            <Icon
              path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v4h4v2h-4v4h-2v-4H7v-2h4V7h2Z"
              size={16}
            />
          </button>
        </div>
      </div>

      <main className="main">
        <div className="chatColumn">
          <Chat
            messages={messages}
            onSend={handleSend}
            threadTitle={threadTitle}
            onOpenSidebar={() => setSidebarCollapsed(false)}
            onNewChat={handleNewChat}
          />
        </div>
      </main>

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSubmit={() => setLoginOpen(false)}
      />
    </div>
  );
}
