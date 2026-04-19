"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ToastType = "success" | "error" | "info";

type ToastEntry = {
  id: number;
  type: ToastType;
  message: string;
  durationMs: number;
};

type ToastApi = {
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 3200;

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idCounterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type: ToastType, message: string, durationMs = DEFAULT_DURATION_MS) => {
      const id = ++idCounterRef.current;
      setToasts((prev) => [...prev, { id, type, message, durationMs }]);
    },
    [],
  );

  const api: ToastApi = {
    success: (m, d) => show("success", m, d),
    error: (m, d) => show("error", m, d ?? 4500),
    info: (m, d) => show("info", m, d),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToasterProvider>");
  }
  return ctx;
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="fixed top-[max(env(safe-area-inset-top),12px)] left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-24px)] max-w-md"
      role="region"
      aria-label="通知"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

const STYLES: Record<ToastType, { bg: string; border: string; icon: React.ReactNode }> = {
  success: {
    bg: "bg-[#0f1d14]",
    border: "border-green-500/40",
    icon: (
      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  error: {
    bg: "bg-[#1d1013]",
    border: "border-[#e63946]/50",
    icon: (
      <svg className="w-4 h-4 text-[#e63946]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
  info: {
    bg: "bg-[#0f151d]",
    border: "border-blue-400/40",
    icon: (
      <svg className="w-4 h-4 text-blue-300" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    const timer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onDismiss, 180);
    }, toast.durationMs);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [toast.durationMs, onDismiss]);

  const style = STYLES[toast.type];

  return (
    <button
      type="button"
      onClick={() => {
        setVisible(false);
        window.setTimeout(onDismiss, 180);
      }}
      className={`pointer-events-auto w-full text-left ${style.bg} ${style.border} border backdrop-blur-sm rounded-lg shadow-lg px-4 py-2.5 flex items-start gap-2.5 transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
      aria-label={`通知を閉じる: ${toast.message}`}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <span className="text-xs sm:text-sm text-white leading-relaxed flex-1">
        {toast.message}
      </span>
    </button>
  );
}
