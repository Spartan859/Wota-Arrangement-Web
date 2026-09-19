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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button aria-label="关闭对话框" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
