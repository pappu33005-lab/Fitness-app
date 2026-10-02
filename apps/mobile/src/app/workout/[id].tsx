import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { formatWeight } from "@vitacore/domain";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { addSet, finishWorkout, setsForSession } from "@/data/logs";
import { exercises } from "@/exercises/catalog";
import { successHaptic } from "@/lib/haptics";
import { useAppState } from "@/data/app-state";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

export default function WorkoutScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id, exercise } = useLocalSearchParams<{ id: string; exercise?: string }>();
  const { haptics, profile } = useAppState();
  const selected = exercises.find((item) => item.id === exercise) ?? exercises[0];
  const [reps, setReps] = useState("8");
  const [weight, setWeight] = useState("");
  const [sets, setSets] = useState<Awaited<ReturnType<typeof setsForSession>>>([]);
  const [rest, setRest] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = profile?.unitSystem ?? "metric";

  const load = useCallback(() => {
    if (id) void setsForSession(id).then(setSets);
  }, [id]);
  useFocusEffect(load);
  const resting = rest != null;
  useEffect(() => {
    if (!resting) return;
    const timer = setInterval(() => {
      setRest((current) => (current == null || current <= 1 ? null : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resting]);

  return (
    <Screen>
      <AppText variant="h1">{selected?.name ?? "Session"}</AppText>
      <AppText variant="caption">{selected?.safety}</AppText>
      <View style={{ height: space.md }} />
      <TextField label="Reps" value={reps} onChangeText={setReps} keyboardType="numeric" />
      <View style={{ height: space.sm }} />
      <TextField label={units === "imperial" ? "Weight (lb)" : "Weight (kg)"} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <View style={{ height: space.md }} />
      <Button
        label={adding ? "Saving set…" : "Complete set"}
        disabled={adding || finishing}
        onPress={() => {
          if (!id || !selected || adding || finishing) return;
          const kg = units === "imperial" && weight ? Number(weight) / 2.2046226218 : weight ? Number(weight) : null;
          setAdding(true);
          setError(null);
          void addSet({
            sessionId: id,
            exerciseId: selected.id,
            exerciseName: selected.name,
            reps: Number(reps) || null,
            weightKg: kg,
          })
            .then(() => {
              void successHaptic(haptics);
              setRest(90);
              load();
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "This set could not be saved.");
            })
            .finally(() => setAdding(false));
        }}
      />
      {rest != null ? (
        <View style={{ marginTop: space.md }}>
          <AppText variant="h2">Rest {rest}s</AppText>
          <Button label="Skip rest" tone="secondary" onPress={() => setRest(null)} />
        </View>
      ) : null}
      <View style={{ height: space.lg }} />
      {sets.map((set) => (
        <AppText key={set.id} variant="small">
          {set.exercise_name} set {set.set_index} · {set.reps ?? "—"} reps ·{" "}
          {set.weight_kg == null ? "—" : formatWeight(set.weight_kg, units)}
        </AppText>
      ))}
      <View style={{ height: space.lg }} />
      {error ? <AppText variant="small" color={colors.accent}>{error}</AppText> : null}
      <Button
        label={finishing ? "Saving…" : "Finish session"}
        tone="secondary"
        disabled={finishing || adding}
        onPress={() => {
          if (!id || finishing || adding) return;
          setFinishing(true);
          setError(null);
          void finishWorkout(id)
            .then(() => {
              void successHaptic(haptics);
              router.replace("/workout");
            })
            .catch((reason: unknown) => {
              setFinishing(false);
              setError(reason instanceof Error ? reason.message : "This session could not be finished.");
            });
        }}
      />
    </Screen>
  );
}
