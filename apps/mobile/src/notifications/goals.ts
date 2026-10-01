/** Assembles today's real goal progress from existing local data — nothing here is invented. */
import { deviceTimeZone, localDay, type GoalProgress } from "@vitacore/domain";
import { readSteps } from "@/health";
import { waterForDay } from "@/data/logs";
import type { LocalProfile } from "@/data/db";

export async function currentGoalProgress(profile: LocalProfile | null): Promise<GoalProgress> {
  const day = localDay(new Date(), deviceTimeZone());
  const [stepReading, waterMl] = await Promise.all([readSteps(), waterForDay(day)]);
  return {
    stepsToday: stepReading.status === "value" ? stepReading.steps : null,
    stepGoal: profile?.stepGoal ?? null,
    waterMlToday: waterMl,
    hydrationTargetMl: profile?.hydrationTargetMl ?? null,
  };
}
