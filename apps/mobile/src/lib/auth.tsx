import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useState } from "react";

import type { Session } from "@supabase/supabase-js";

import { getSupabaseClient, hasSupabaseEnv } from "./supabase";

type AuthContextValue = {
  booting: boolean;
  envReady: boolean;
  session: Session | null;
};

const AuthContext = createContext<AuthContextValue>({
  booting: true,
  envReady: false,
  session: null,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const envReady = hasSupabaseEnv();
  const [booting, setBooting] = useState(envReady);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!envReady) {
      return;
    }

    let cancelled = false;
    const supabase = getSupabaseClient();

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }

        if (!cancelled) {
          setSession(data.session);
        }
      })
      .catch((error) => {
        console.error("Failed to restore Supabase session.", error);
        if (!cancelled) {
          setSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [envReady]);

  return <AuthContext.Provider value={{ booting, envReady, session }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
