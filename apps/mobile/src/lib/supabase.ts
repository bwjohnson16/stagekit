import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import type { Database } from "./database";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
let isAutoRefreshBound = false;
let client: ReturnType<typeof createClient<Database>> | null = null;

export function hasSupabaseEnv() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init = {}) => {
    const abortController = new AbortController();
    const upstreamSignal = init.signal;
    const abortFromUpstream = () => abortController.abort();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    if (upstreamSignal?.aborted) {
      abortController.abort();
    } else {
      upstreamSignal?.addEventListener("abort", abortFromUpstream);
    }

    try {
      return await fetch(input, {
        ...init,
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted && !upstreamSignal?.aborted) {
        throw new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

export function getSupabaseClient() {
  if (client) {
    return client;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env");
  }

  client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS),
    },
  });

  if (!isAutoRefreshBound) {
    AppState.addEventListener("change", (state) => {
      if (state === "active") {
        client?.auth.startAutoRefresh();
        return;
      }

      client?.auth.stopAutoRefresh();
    });
    isAutoRefreshBound = true;
  }

  return client;
}
