/**
 * Pure rules for binding local SQLite data to an authenticated Supabase user.
 * Prevents User A's local rows/outbox from uploading under User B's session.
 */

export type LocalAccountBinding =
  | { status: "unbound" }
  | { status: "bound"; userId: string };

export type AccountSyncDecision =
  | { action: "claim_and_sync"; bindUserId: string }
  | { action: "await_claim_confirmation"; bindUserId: string }
  | { action: "sync" }
  | { action: "block_mismatch"; boundUserId: string; sessionUserId: string }
  | { action: "skip_signed_out" };

export type DecideAccountSyncOptions = {
  /**
   * True only after the user explicitly confirms associating unbound guest/local
   * data with this account. Without confirmation, unbound data is not claimed.
   */
  claimConfirmed?: boolean;
};

/**
 * Decides whether a sync pass may upload local data for the current session.
 *
 * - No session → never upload.
 * - Unbound local data + signed-in session → require explicit claim confirmation,
 *   then bind and sync (guest → first account). Never silent.
 * - Bound to same user → sync.
 * - Bound to a different user → block; do not upload or rebind silently.
 */
export function decideAccountSync(
  binding: LocalAccountBinding,
  sessionUserId: string | null,
  options: DecideAccountSyncOptions = {},
): AccountSyncDecision {
  if (!sessionUserId) return { action: "skip_signed_out" };
  if (binding.status === "unbound") {
    if (options.claimConfirmed) return { action: "claim_and_sync", bindUserId: sessionUserId };
    return { action: "await_claim_confirmation", bindUserId: sessionUserId };
  }
  if (binding.userId === sessionUserId) return { action: "sync" };
  return {
    action: "block_mismatch",
    boundUserId: binding.userId,
    sessionUserId,
  };
}

/** True only when uploading under this session cannot cross-attribute local data. */
export function canUploadForSession(
  binding: LocalAccountBinding,
  sessionUserId: string | null,
  options: DecideAccountSyncOptions = {},
): boolean {
  const decision = decideAccountSync(binding, sessionUserId, options);
  return decision.action === "sync" || decision.action === "claim_and_sync";
}
