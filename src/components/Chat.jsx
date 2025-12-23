import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import { BrandMark } from "./BrandMark.jsx";

hljs.registerLanguage("python", python);

function Icon({ path, size = 18, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"}>
      {title ? <title>{title}</title> : null}
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function LineIcon({ children, size = 18, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : "true"}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightCode(code, lang) {
  const normalized = (lang || "").toLowerCase();
  const resolvedLang = normalized === "py" ? "python" : normalized;
  if (resolvedLang && hljs.getLanguage(resolvedLang)) {
    return hljs.highlight(code, { language: resolvedLang }).value;
  }
  return escapeHtml(code);
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to legacy copy.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function ActionButton({ label, children, onClick }) {
  return (
    <button className="msgActionBtn" type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

const MarkdownComponents = {
  pre: ({ children }) => <>{children}</>,
  code: ({ node, inline, className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match ? match[1] : "";
    const codeText = String(children).replace(/\n$/, "");

    if (!inline && match) {
      const highlighted = highlightCode(codeText, lang);
      const label = (lang || "code").toLowerCase();
      return (
        <div className="msgCodeBlock">
          <div className="msgCodeHeader">
            <span className="msgCodeLabel">{label}</span>
            <button
              className="codeCopyButton"
              type="button"
              aria-label="코드 복사"
              onClick={() => copyToClipboard(codeText)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
          <pre>
            <code
              className={`${className || ""} hljs`.trim()}
              dangerouslySetInnerHTML={{ __html: highlighted }}
              {...props}
            />
          </pre>
        </div>
      );
    }
    return <code className={className} {...props}>{children}</code>;
  }
};



function MessageItem({ role, content, pending, error }) {
  const isUser = role === "user";
  const statusClass = pending ? "msgBlockPending" : error ? "msgBlockError" : "";

  async function handleCopy() {
    await copyToClipboard(content);
  }

  return (
    <div className={`msgBlock ${isUser ? "msgBlockUser" : "msgBlockAssistant"} ${statusClass}`}>
      <div className={isUser ? "userBubble" : "assistantText"}>
        <div className="msgContent">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </div>

      <div className={`msgActions ${isUser ? "msgActionsUser" : "msgActionsAssistant"}`}>
        <ActionButton label="복사" onClick={handleCopy}>
          <LineIcon>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </LineIcon>
        </ActionButton>

        {isUser ? (
          <ActionButton label="수정">
            <LineIcon>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </LineIcon>
          </ActionButton>
        ) : (
          <>
            <ActionButton label="재생성">
              <LineIcon>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
                <path d="M1 14l5.37 4.36A9 9 0 0 0 20.49 15" />
              </LineIcon>
            </ActionButton>
            <ActionButton label="좋아요">
              <LineIcon>
                <path d="M7 22V10" />
                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.5a2 2 0 0 0 1.79-1.11L12 2a3 3 0 0 1 3 3.88Z" />
              </LineIcon>
            </ActionButton>
            <ActionButton label="별로예요">
              <LineIcon>
                <path d="M17 2v12" />
                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2.5a2 2 0 0 0-1.79 1.11L12 22a3 3 0 0 1-3-3.88Z" />
              </LineIcon>
            </ActionButton>
            <ActionButton label="공유">
              <LineIcon>
                <path d="M12 3v12" />
                <path d="m7 8 5-5 5 5" />
                <path d="M5 21h14" />
              </LineIcon>
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}



export default function Chat({ messages, onSend, threadTitle, onOpenSidebar, onNewChat }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  const title = useMemo(() => threadTitle || "New chat", [threadTitle]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, [text]);

  function commitSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  function handleSubmit(e) {
    e.preventDefault();
    commitSend();
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitSend();
    }
  }

  const composer = (
    <form className="composerCard" onSubmit={handleSubmit}>
      <div className="composerTop">
        <textarea
          ref={textareaRef}
          className="composerTextarea"
          value={text}
          placeholder="백집사에게 물어보세요!"
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

      </div>

      <div className="composerBottom">
        <div className="composerActions">
          <button className="iconButton" type="button" aria-label="Attachment">
            <Icon
              path="M16.5 6.5 9 14a3 3 0 0 0 4.24 4.24l7.07-7.07a5 5 0 0 0-7.07-7.07L5.5 11.84a7 7 0 1 0 9.9 9.9l3.89-3.89a1 1 0 1 0-1.41-1.41l-3.89 3.89a5 5 0 1 1-7.07-7.07l7.78-7.78a3 3 0 0 1 4.24 4.24l-7.07 7.07a1 1 0 1 1-1.41-1.41l7.5-7.5a1 1 0 1 0-1.41-1.41Z"
              size={20}
            />
          </button>
          <button className="sendFab" type="submit" disabled={!text.trim()} aria-label="Send">
            <Icon path="M12 4l7 7-1.41 1.41L13 7.83V20h-2V7.83L6.41 12.4 5 11l7-7Z" size={18} />
          </button>
        </div>
      </div>
    </form>
  );

  // Mobile Header Component
  const mobileHeader = (
    <div className="mobileHeader">
      <div className="mobileHeaderLeft">
        <button className="mobileMenuBtn" onClick={onOpenSidebar} aria-label="Open Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
          </svg>
        </button>

      </div>

    </div>
  );

  if (messages.length === 0) {
    return (
      <div className="chatEmpty" aria-label={title}>
        {mobileHeader}
        <div className="heroRow">
          <div className="heroIcon" aria-hidden="true">
            <BrandMark size={50} />
          </div>
          <div className="heroTitle">어떤 도움이 필요하세요?</div>
        </div>
        {composer}
      </div>
    );
  }

  function scrollToTop() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="chatConversation" aria-label={title}>
      {mobileHeader}
      <div className="chatTopBar">
        <div className="chatTopBarInner">
          <div className="chatTopSpacer" aria-hidden="true" />
          <div className="chatTopTitle">{title}</div>
        </div>
      </div>

      <div className="chatList" ref={listRef} role="log" aria-live="polite">
        <div className="chatListInner">
          {messages.map((m) => (
            <MessageItem key={m.id} role={m.role} content={m.content} pending={m.pending} error={m.error} />
          ))}
        </div>
      </div>

      <div className="chatDock">
        {composer}
        <div className="chatFootnote">AI can make mistakes. Please check important info.</div>
      </div>
    </div>
  );
}
