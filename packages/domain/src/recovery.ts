export type RecoveryInput = {
  sleepScore: number | null;
  restingHr: number | null;
  restingHrBaseline: number | null;
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  /** Recent training load in the same arbitrary unit as chronicLoad. */
  recentLoad: number | null;
  chronicLoad: number | null;
};

export type RecoveryFactorId = "sleep" | "resting_hr" | "hrv" | "load";

export type RecoveryFactor = {
  id: RecoveryFactorId;
  weight: number;
  score: number;
  detail: string;
};

export type RecoveryScore =
  | { status: "scored"; score: number; factors: RecoveryFactor[]; omitted: RecoveryFactorId[] }
  | { status: "unavailable"; reason: "insufficient_inputs" };

const BASE_WEIGHT: Record<RecoveryFactorId, number> = {
  sleep: 0.35,
  resting_hr: 0.2,
  hrv: 0.25,
  load: 0.2,
};

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function scoreRecovery(input: RecoveryInput): RecoveryScore {
  const raw: Array<Omit<RecoveryFactor, "weight"> & { baseWeight: number }> = [];

  if (input.sleepScore != null) {
    raw.push({
      id: "sleep",
      baseWeight: BASE_WEIGHT.sleep,
      score: clampScore(input.sleepScore),
      detail: "Uses the sleep score already calculated from available sleep inputs.",
    });
  }

  if (input.restingHr != null && input.restingHrBaseline != null && input.restingHrBaseline > 0) {
    const ratio = input.restingHr / input.restingHrBaseline;
    raw.push({
      id: "resting_hr",
      baseWeight: BASE_WEIGHT.resting_hr,
      score: clampScore(100 - (ratio - 1) * 250),
      detail: "Resting heart rate compared with your own baseline. A higher rate lowers the score.",
    });
  }

  if (input.hrvMs != null && input.hrvBaselineMs != null && input.hrvBaselineMs > 0) {
    const ratio = input.hrvMs / input.hrvBaselineMs;
    raw.push({
      id: "hrv",
      baseWeight: BASE_WEIGHT.hrv,
      score: clampScore(100 - (1 - ratio) * 200),
      detail: "Heart-rate variability compared with your own baseline.",
    });
  }

  if (input.recentLoad != null && input.chronicLoad != null && input.chronicLoad > 0) {
    const ratio = input.recentLoad / input.chronicLoad;
    raw.push({
      id: "load",
      baseWeight: BASE_WEIGHT.load,
      score: clampScore(100 - Math.abs(ratio - 1) * 80),
      detail: "Recent load compared with your longer-run load. This is a balance hint, not a medical clearance.",
    });
  }

  if (raw.length < 2) return { status: "unavailable", reason: "insufficient_inputs" };

  const weightSum = raw.reduce((sum, factor) => sum + factor.baseWeight, 0);
  const score = clampScore(raw.reduce((sum, factor) => sum + factor.score * factor.baseWeight, 0) / weightSum);
  const present = new Set(raw.map((factor) => factor.id));
  const omitted = (Object.keys(BASE_WEIGHT) as RecoveryFactorId[]).filter((id) => !present.has(id));

  return {
    status: "scored",
    score,
    omitted,
    factors: raw.map((factor) => ({
      id: factor.id,
      weight: factor.baseWeight / weightSum,
      score: factor.score,
      detail: factor.detail,
    })),
  };
}
