import { useMemo, useState } from "react";
import { View } from "react-native";
import { brandConfig } from "@vitacore/brand";
import type { ActivityLevel, BodyGoal, DietaryPreference, FitnessLevel, SexForEstimate, UnitSystem, WorkoutPreference } from "@vitacore/domain";
import { cmToFeetAndInches, estimateDailyCalories, feetAndInchesToCm, kgToLb, lbToKg } from "@vitacore/domain";
import { AppText, Button, ChoiceList, Screen, SegmentedControl, TextField } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { recordEvent } from "@/data/logs";
import { createId } from "@/lib/id";
import { copy } from "@/i18n/copy";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

const steps = ["welcome", "name", "goal", "level", "body", "activity", "training", "food", "sleep", "ready"] as const;

export default function OnboardingScreen() {
  const { updateProfile } = useAppState();
  const { colors } = useTheme();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<BodyGoal | null>(null);
  const [level, setLevel] = useState<FitnessLevel | null>(null);
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<SexForEstimate | null>(null);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [height, setHeight] = useState("");
  const [inches, setInches] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [training, setTraining] = useState<WorkoutPreference | null>(null);
  const [diet, setDiet] = useState<DietaryPreference>("none");
  const [sleepHours, setSleepHours] = useState("8");
  const [waterMl, setWaterMl] = useState("2000");
  const [stepGoal, setStepGoal] = useState("8000");
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = steps[step] ?? "welcome";

  const heightCm = units === "metric" ? Number(height) : feetAndInchesToCm(Number(height) || 0, Number(inches) || 0);
  const weightKg = units === "metric" ? Number(weight) : lbToKg(Number(weight));
  const estimate = useMemo(
    () =>
      estimateDailyCalories({
        ageYears: Number(age) || null,
        sex,
        heightCm: Number.isFinite(heightCm) ? heightCm : null,
        weightKg: Number.isFinite(weightKg) ? weightKg : null,
        activityLevel: activity,
        goal,
      }),
    [activity, age, goal, heightCm, sex, weightKg],
  );

  async function finish() {
    await recordEvent("onboarding_completed");
    await updateProfile({
      id: createId(),
      displayName: name.trim() || null,
      ageYears: Number(age) || null,
      sex,
      heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : null,
      weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null,
      fitnessLevel: level,
      activityLevel: activity,
      goal,
      unitSystem: units,
      workoutPreference: training,
      dietary: [diet],
      sleepTargetMinutes: Math.round(Number(sleepHours) * 60) || null,
      hydrationTargetMl: Number(waterMl) || null,
      stepGoal: Number(stepGoal) || null,
      onboardingCompletedAt: new Date().toISOString(),
    });
  }

  return (
    <Screen>
      <AppText variant="label">{brandConfig.name}</AppText>
      <AppText variant="caption">{step + 1} of {steps.length}</AppText>
      <View style={{ height: space.lg }} />
      {current === "welcome" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="display">A quieter way to see the day.</AppText>
          <AppText variant="body" color={colors.textSecondary}>Sleep, recovery, training, and food in one place. Measurements stay blank until a real source provides them.</AppText>
          <AppText variant="small" color={colors.textSecondary}>{copy.guestCloud}</AppText>
        </View>
      ) : null}
      {current === "name" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">What should we call you?</AppText>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Optional" />
        </View>
      ) : null}
      {current === "goal" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">What are you working toward?</AppText>
          <ChoiceList
            value={goal}
            onChange={setGoal}
            options={[
              { value: "maintain", label: "Maintain", detail: "Keep intake near the estimate." },
              { value: "lose", label: "Lose weight", detail: "About 15% under the estimate." },
              { value: "gain", label: "Gain weight", detail: "About 10% over the estimate." },
              { value: "performance", label: "Performance", detail: "A little extra for training." },
            ]}
          />
        </View>
      ) : null}
      {current === "level" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">Training experience</AppText>
          <ChoiceList
            value={level}
            onChange={setLevel}
            options={[
              { value: "beginner", label: "Beginner" },
              { value: "intermediate", label: "Intermediate" },
              { value: "advanced", label: "Advanced" },
            ]}
          />
        </View>
      ) : null}
      {current === "body" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">Body details for the estimate</AppText>
          <AppText variant="small" color={colors.textSecondary}>Used for the calorie equation only. You can leave sex unspecified.</AppText>
          <SegmentedControl
            value={units}
            onChange={setUnits}
            options={[{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }]}
          />
          <TextField label="Age" value={age} onChangeText={setAge} keyboardType="numeric" />
          <ChoiceList
            value={sex}
            onChange={setSex}
            options={[
              { value: "female", label: "Female constant" },
              { value: "male", label: "Male constant" },
              { value: "unspecified", label: "Use the midpoint" },
            ]}
          />
          {units === "metric" ? (
            <TextField label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="decimal-pad" />
          ) : (
            <View style={{ gap: space.sm }}>
              <TextField label="Feet" value={height} onChangeText={setHeight} keyboardType="numeric" />
              <TextField label="Inches" value={inches} onChangeText={setInches} keyboardType="numeric" />
            </View>
          )}
          <TextField label={units === "metric" ? "Weight (kg)" : "Weight (lb)"} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        </View>
      ) : null}
      {current === "activity" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">How active is a normal day?</AppText>
          <ChoiceList
            value={activity}
            onChange={setActivity}
            options={[
              { value: "sedentary", label: "Mostly seated" },
              { value: "light", label: "Light movement" },
              { value: "moderate", label: "On your feet often" },
              { value: "very", label: "Hard most days" },
              { value: "athlete", label: "Training is the job" },
            ]}
          />
        </View>
      ) : null}
      {current === "training" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">What do you want nearby?</AppText>
          <ChoiceList
            value={training}
            onChange={setTraining}
            options={[
              { value: "strength", label: "Strength" },
              { value: "cardio", label: "Cardio" },
              { value: "mixed", label: "Mixed" },
              { value: "mobility", label: "Mobility" },
            ]}
          />
        </View>
      ) : null}
      {current === "food" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">Eating pattern</AppText>
          <ChoiceList
            value={diet}
            onChange={setDiet}
            options={[
              { value: "none", label: "No specific pattern" },
              { value: "vegetarian", label: "Vegetarian" },
              { value: "vegan", label: "Vegan" },
              { value: "pescatarian", label: "Pescatarian" },
              { value: "gluten_free", label: "Gluten free" },
              { value: "dairy_free", label: "Dairy free" },
            ]}
          />
        </View>
      ) : null}
      {current === "sleep" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">Targets</AppText>
          <TextField label="Sleep hours" value={sleepHours} onChangeText={setSleepHours} keyboardType="decimal-pad" />
          <TextField label="Water (ml)" value={waterMl} onChangeText={setWaterMl} keyboardType="numeric" />
          <TextField label="Steps" value={stepGoal} onChangeText={setStepGoal} keyboardType="numeric" />
          <AppText variant="caption">These are goals, not measurements. Change them later in profile.</AppText>
        </View>
      ) : null}
      {current === "ready" ? (
        <View style={{ gap: space.md }}>
          <AppText variant="h1">You can start without an account.</AppText>
          <AppText variant="small" color={colors.textSecondary}>{copy.guestCloud}</AppText>
          <AppText variant="small" color={colors.textSecondary}>{copy.healthWeb}</AppText>
          <AppText variant="small">
            {estimate.status === "estimated"
              ? `Estimated intake ${estimate.kcal.toLocaleString("en-US")} kcal. ${estimate.disclaimer}`
              : estimate.reason === "adult_formula_does_not_apply"
                ? copy.calorieMinor
                : "The calorie estimate is waiting on the details above."}
          </AppText>
          {units === "imperial" && heightCm > 0 ? (
            <AppText variant="caption">Saved height {cmToFeetAndInches(heightCm).feet} ft {cmToFeetAndInches(heightCm).inches} in · weight {kgToLb(weightKg).toFixed(1)} lb</AppText>
          ) : null}
        </View>
      ) : null}
      <View style={{ height: space.xl }} />
      {saveError ? <AppText variant="small">{saveError}</AppText> : null}
      <Button
        label={current === "ready" ? "Enter" : "Continue"}
        onPress={() => {
          if (current === "welcome") void recordEvent("onboarding_started");
          if (current === "ready") {
            void finish().catch((error: unknown) => {
              setSaveError(error instanceof Error ? error.message : "The profile could not be saved on this device.");
            });
            return;
          }
          setStep((value) => value + 1);
        }}
      />
      {step > 0 ? (
        <View style={{ height: space.sm }} />
      ) : null}
      {step > 0 ? <Button label="Back" tone="ghost" onPress={() => setStep((value) => value - 1)} /> : null}
    </Screen>
  );
}
