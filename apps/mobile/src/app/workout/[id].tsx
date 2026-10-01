import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { addSet, finishWorkout, setsForSession } from "@/data/logs";
import { exercises } from "@/exercises/catalog";
import { successHaptic } from "@/lib/haptics";
import { useAppState } from "@/data/app-state";
import { space } from "@/design/tokens";

export default function WorkoutScreen() {
  const { id, exercise } = useLocalSearchParams<{ id: string; exercise?: string }>();
  const { haptics, profile } = useAppState();
  const selected = exercises.find((item) => item.id === exercise) ?? exercises[0];
  const [reps, setReps] = useState("8");
  const [weight, setWeight] = useState("");
  const [sets, setSets] = useState<Awaited<ReturnType<typeof setsForSession>>>([]);
  const [rest, setRest] = useState<number | null>(null);

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
      <TextField label={profile?.unitSystem === "imperial" ? "Weight (lb)" : "Weight (kg)"} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <View style={{ height: space.md }} />
      <Button
        label="Complete set"
        onPress={() => {
          if (!id || !selected) return;
          const kg = profile?.unitSystem === "imperial" && weight ? Number(weight) / 2.2046226218 : weight ? Number(weight) : null;
          void addSet({
            sessionId: id,
            exerciseId: selected.id,
            exerciseName: selected.name,
            reps: Number(reps) || null,
            weightKg: kg,
          }).then(() => {
            void successHaptic(haptics);
            setRest(90);
            load();
          });
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
        <AppText key={set.id} variant="small">{set.exercise_name} set {set.set_index} · {set.reps ?? "—"} reps · {set.weight_kg ?? "—"} kg</AppText>
      ))}
      <View style={{ height: space.lg }} />
      <Button label="Finish session" tone="secondary" onPress={() => id && void finishWorkout(id)} />
    </Screen>
  );
}
