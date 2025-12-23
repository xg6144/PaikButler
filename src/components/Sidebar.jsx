import { BrandMark } from "./BrandMark.jsx";

function Icon({ path, size = 20, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"}>
      {title ? <title>{title}</title> : null}
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function groupThreads(threads) {
  const order = ["Today"];
  const map = new Map();

  for (const t of threads) {
    if (!map.has(t.section)) map.set(t.section, []);
    map.get(t.section).push(t);
    if (!order.includes(t.section)) order.push(t.section);
  }

  return order.filter((k) => map.has(k)).map((k) => ({ section: k, items: map.get(k) }));
}

export default function Sidebar({ threads, activeThreadId, displayName, onNewChat, onSelectThread, onCollapse, onLogin }) {
  const grouped = groupThreads(threads);

  const avatarText = (displayName || "전동빈").slice(-2);
  return (
    <div className="sidebarInner">
      <div className="brandBar">
        <div className="brand" onClick={onNewChat}>
          <span className="brandMark" aria-hidden="true">
            <BrandMark size={60} />
          </span>
          <span className="brandText">Paik Butler</span>
        </div>
        <button className="collapseBtn" type="button" aria-label="접기" onClick={onCollapse}>
          <svg className="sidebarIconDesktop" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <path d="M9 3v18" />
            <path d="m15 15-3-3 3-3" />
          </svg>
          <svg className="sidebarIconMobile" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <button className="newChatBtn" type="button" onClick={onNewChat}>
        <span className="newChatText">새로운 대화</span>
      </button>

      <div className="threadList" aria-label="대화 목록">
        {grouped.map((g) => (
          <div key={g.section} className="threadGroup">
            <div className="threadSection">{g.section}</div>
            {g.items.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`threadItem ${t.id === activeThreadId ? "threadItemActive" : ""}`}
                onClick={() => onSelectThread(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebarFooter">
        <button className="loginBtn" type="button" onClick={onLogin}>
          <span className="loginIcon" aria-hidden="true">
            <Icon
              path="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm9 11v-1a7 7 0 0 0-7-7h-4a7 7 0 0 0-7 7v1h2v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1z"
              size={20}
            />
          </span>
          <span className="loginText">로그인</span>
        </button>
      </div>
    </div>
  );
}
