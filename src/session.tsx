import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchSession } from "./api/client";
import type { SessionState } from "./core/share";

type SessionContextValue = {
  session: SessionState;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (returnTo?: string) => void;
  logout: () => void;
};

const emptySession: SessionState = {
  authenticated: false,
  csrfToken: null,
  user: null,
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>(emptySession);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setSession(await fetchSession());
  };
  useEffect(() => {
    let active = true;
    fetchSession()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(emptySession);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const login = (
    returnTo = window.location.pathname + window.location.search,
  ) => {
    window.location.assign(
      `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  };
  const logout = () => window.location.assign("/api/auth/logout");
  return (
    <SessionContext.Provider
      value={{ session, loading, refresh, login, logout }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used inside SessionProvider.");
  return context;
}
