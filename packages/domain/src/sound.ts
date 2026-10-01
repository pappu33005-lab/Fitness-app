export type SoundClass = "snoring" | "cough" | "speech" | "environmental" | "unknown";

export type SoundConsent = "unset" | "granted" | "denied";

/** Metadata for a detected moment. Raw audio is intentionally not part of this record. */
export type SoundEventMetadata = {
  id: string;
  startedAt: string;
  durationMs: number;
  classification: SoundClass;
  /** Model confidence from 0 to 1. Not a medical probability. */
  confidence: number;
};

export const SOUND_RETENTION = {
  storeRawAudio: false,
  uploadRawAudio: false,
  encryptEventMetadata: true,
  userCanDelete: true,
} as const;

export type SoundModelAvailability =
  | { status: "ready" }
  | { status: "unavailable"; reason: "model_not_bundled" | "permission_required" | "permission_denied" };

/** No classifier ships in this build. Callers must not invent classifications. */
export function soundModelAvailability(consent: SoundConsent): SoundModelAvailability {
  if (consent !== "granted") {
    return {
      status: "unavailable",
      reason: consent === "denied" ? "permission_denied" : "permission_required",
    };
  }
  return { status: "unavailable", reason: "model_not_bundled" };
}
