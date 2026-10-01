import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, FilterChips, Screen, SearchBar } from "@/components/ui";
import { createWorkout } from "@/data/logs";
import { exercises } from "@/exercises/catalog";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

export default function ExercisesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState<string | null>(null);
  const equipmentOptions = [...new Set(exercises.map((item) => item.equipment))];
  const filtered = useMemo(
    () =>
      exercises.filter((item) => {
        const matchesQuery = item.name.toLowerCase().includes(query.trim().toLowerCase());
        const matchesEquipment = equipment == null || item.equipment === equipment;
        return matchesQuery && matchesEquipment;
      }),
    [equipment, query],
  );

  return (
    <Screen>
      <AppText variant="h1">Exercises</AppText>
      <AppText variant="small" color={colors.textSecondary}>A small original set. No licensed video is bundled. A library can be added behind this list later.</AppText>
      <View style={{ height: space.md }} />
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search exercises" />
      <View style={{ height: space.md }} />
      <FilterChips options={equipmentOptions} value={equipment} onChange={setEquipment} />
      <View style={{ height: space.lg }} />
      {filtered.map((item) => (
        <View key={item.id} style={{ paddingVertical: space.md, gap: 6 }}>
          <AppText variant="h3">{item.name}</AppText>
          <AppText variant="caption">{item.primaryMuscle} · {item.equipment} · {item.difficulty}</AppText>
          <AppText variant="small">{item.instructions.join(" ")}</AppText>
          <AppText variant="caption">{item.safety}</AppText>
          <Button
            label="Start session with this"
            tone="secondary"
            onPress={() => {
              void createWorkout().then((id) => router.push(`/workout/${id}?exercise=${item.id}`));
            }}
          />
        </View>
      ))}
    </Screen>
  );
}
