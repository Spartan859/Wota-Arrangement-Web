import { useEffect, useRef, useState, type ReactNode } from "react";
export function Field({
  label,
  value,
  onCommit,
  multiline = false,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const common = {
    "aria-label": label,
    value: draft,
    disabled,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) {
        const committed = draft;
        setDraft(value);
        onCommit(committed);
      }
    },
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing)
              e.currentTarget.blur();
          }}
        />
      )}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  headerActions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  headerActions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const ignoreCancel = useRef(false);
  const cancelTimer = useRef<number | null>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => {
      if (cancelTimer.current !== null)
        window.clearTimeout(cancelTimer.current);
    };
  }, []);
  const armCancelGuard = () => {
    ignoreCancel.current = true;
    if (cancelTimer.current !== null) window.clearTimeout(cancelTimer.current);
    cancelTimer.current = window.setTimeout(() => {
      ignoreCancel.current = false;
      cancelTimer.current = null;
    }, 1500);
  };
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onClickCapture={(event) => {
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === "file"
        )
          armCancelGuard();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (ignoreCancel.current) {
          ignoreCancel.current = false;
          return;
        }
        onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        {headerActions && (
          <div className="modal-header-actions">{headerActions}</div>
        )}
        <button aria-label="关闭对话框" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
