import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authStorage } from "./storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function supabaseConfigStatus(): "ready" | "missing" {
  if (!url || !anonKey) return "missing";
  return "ready";
}

/** The anon key is a public client key. The service role key is never read here. */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
