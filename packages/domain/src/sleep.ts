export type SleepStageMinutes = {
  awake: number;
  rem: number;
  light: number;
  deep: number;
};

export type SleepScoreInput = {
  asleepMinutes: number | null;
  inBedMinutes: number | null;
  targetMinutes: number | null;
  /** Absolute difference from the person's usual bedtime, in minutes. Null when unknown. */
  bedtimeDeviationMinutes: number | null;
  disturbanceCount: number | null;
  stageMinutes: SleepStageMinutes | null;
};

export type SleepFactorId = "duration" | "efficiency" | "consistency" | "disturbances" | "stages";

export type SleepFactor = {
  id: SleepFactorId;
  /** Share of this score after missing factors are removed. */
  weight: number;
  score: number;
  detail: string;
};

export type SleepScore =
  | {
      status: "scored";
      score: number;
      factors: SleepFactor[];
      omitted: SleepFactorId[];
    }
  | { status: "unavailable"; reason: "no_inputs" };

const BASE_WEIGHT: Record<SleepFactorId, number> = {
  duration: 0.35,
  efficiency: 0.25,
  consistency: 0.15,
  disturbances: 0.15,
  stages: 0.1,
};

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function scoreSleep(input: SleepScoreInput): SleepScore {
  const raw: Array<Omit<SleepFactor, "weight"> & { baseWeight: number }> = [];

  if (input.asleepMinutes != null && input.targetMinutes != null && input.targetMinutes > 0) {
    const ratio = input.asleepMinutes / input.targetMinutes;
    const score = ratio >= 1 ? 100 - (ratio - 1) * 50 : ratio * 100;
    raw.push({
      id: "duration",
      baseWeight: BASE_WEIGHT.duration,
      score: clampScore(score),
      detail: "Time asleep compared with the sleep target you set.",
    });
  }

  if (input.asleepMinutes != null && input.inBedMinutes != null && input.inBedMinutes > 0) {
    const efficiency = Math.min(1, input.asleepMinutes / input.inBedMinutes);
    raw.push({
      id: "efficiency",
      baseWeight: BASE_WEIGHT.efficiency,
      score: clampScore(efficiency * 100),
      detail: "Time asleep divided by time in bed.",
    });
  }

  if (input.bedtimeDeviationMinutes != null) {
    raw.push({
      id: "consistency",
      baseWeight: BASE_WEIGHT.consistency,
      score: clampScore(100 - input.bedtimeDeviationMinutes * 2),
      detail: "How far bedtime moved from your recent usual time.",
    });
  }

  if (input.disturbanceCount != null) {
    raw.push({
      id: "disturbances",
      baseWeight: BASE_WEIGHT.disturbances,
      score: clampScore(100 - input.disturbanceCount * 12),
      detail: "Counted disturbances. This does not identify their cause.",
    });
  }

  if (input.stageMinutes) {
    const total =
      input.stageMinutes.awake +
      input.stageMinutes.rem +
      input.stageMinutes.light +
      input.stageMinutes.deep;
    if (total > 0) {
      const restorative = (input.stageMinutes.rem + input.stageMinutes.deep) / total;
      raw.push({
        id: "stages",
        baseWeight: BASE_WEIGHT.stages,
        score: clampScore(100 - Math.abs(restorative - 0.42) * 220),
        detail: "Share of REM and deep time against a 42% midpoint. A heuristic, not a diagnosis.",
      });
    }
  }

  if (raw.length === 0) return { status: "unavailable", reason: "no_inputs" };

  const weightSum = raw.reduce((sum, factor) => sum + factor.baseWeight, 0);
  const score = clampScore(raw.reduce((sum, factor) => sum + factor.score * factor.baseWeight, 0) / weightSum);
  const present = new Set(raw.map((factor) => factor.id));
  const omitted = (Object.keys(BASE_WEIGHT) as SleepFactorId[]).filter((id) => !present.has(id));

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
