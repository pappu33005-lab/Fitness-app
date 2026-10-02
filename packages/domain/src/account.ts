/**
 * Pure rules for binding local SQLite data to an authenticated Supabase user.
 * Prevents User A's local rows/outbox from uploading under User B's session.
 */

export type LocalAccountBinding =
  | { status: "unbound" }
  | { status: "bound"; userId: string };

export type AccountSyncDecision =
  | { action: "claim_and_sync"; bindUserId: string }
  | { action: "sync" }
  | { action: "block_mismatch"; boundUserId: string; sessionUserId: string }
  | { action: "skip_signed_out" };

/**
 * Decides whether a sync pass may upload local data for the current session.
 *
 * - No session → never upload.
 * - Unbound local data + signed-in session → claim (bind) then sync (guest → first account).
 * - Bound to same user → sync.
 * - Bound to a different user → block; do not upload or rebind silently.
 */
export function decideAccountSync(
  binding: LocalAccountBinding,
  sessionUserId: string | null,
): AccountSyncDecision {
  if (!sessionUserId) return { action: "skip_signed_out" };
  if (binding.status === "unbound") return { action: "claim_and_sync", bindUserId: sessionUserId };
  if (binding.userId === sessionUserId) return { action: "sync" };
  return {
    action: "block_mismatch",
    boundUserId: binding.userId,
    sessionUserId,
  };
}

/** True only when uploading under this session cannot cross-attribute local data. */
export function canUploadForSession(binding: LocalAccountBinding, sessionUserId: string | null): boolean {
  const decision = decideAccountSync(binding, sessionUserId);
  return decision.action === "sync" || decision.action === "claim_and_sync";
}
