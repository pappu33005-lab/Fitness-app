import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authStorage } from "./storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

export function supabaseConfigStatus(): "ready" | "missing" {
  if (!url || !publishableKey) return "missing";
  return "ready";
}

/** The publishable key is a public client key. The service-role / secret key is never read here. */
export function getSupabase(): SupabaseClient | null {
  if (!url || !publishableKey) return null;
  if (!client) {
    client = createClient(url, publishableKey, {
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
