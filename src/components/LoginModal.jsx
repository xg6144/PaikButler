import { useEffect, useId, useRef, useState } from "react";

export default function LoginModal({ open, onClose, onSubmit }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailId = useId();
  const passwordId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.({ email, password });
  };

  return (
    <div className="modalBackdrop" role="presentation" onClick={handleBackdropClick}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <button className="modalCloseBtn" type="button" aria-label="닫기" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M6 6 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="modalHeader">
          <h2 className="modalTitle" id={titleId}>로그인</h2>
          <p className="modalSubtitle" id={descriptionId}>계속하려면 계정으로 로그인하세요.</p>
        </div>

        <form className="modalForm" onSubmit={handleSubmit}>
          <label className="modalField" htmlFor={emailId}>
            <span className="modalLabel">이메일</span>
            <input
              ref={firstFieldRef}
              id={emailId}
              className="modalInput"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="modalField" htmlFor={passwordId}>
            <span className="modalLabel">비밀번호</span>
            <input
              id={passwordId}
              className="modalInput"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호를 입력하세요"
              autoComplete="current-password"
              required
            />
          </label>

          <div className="modalActions">
            <button className="modalSecondaryBtn" type="button" onClick={onClose}>취소</button>
            <button className="modalPrimaryBtn" type="submit">로그인</button>
          </div>
        </form>
      </div>
    </div>
  );
}
