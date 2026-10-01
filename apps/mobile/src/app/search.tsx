import { useState } from "react";
import { View } from "react-native";
import { deviceTimeZone, localDay } from "@vitacore/domain";
import { AppText, Button, Screen, SearchBar } from "@/components/ui";
import { logFood, type MealName } from "@/data/logs";
import { searchOpenFoodFacts, type FoodHit } from "@/nutrition/openFoodFacts";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

export default function SearchScreen() {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [meal, setMeal] = useState<MealName>("lunch");
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <AppText variant="h1">Search food</AppText>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search Open Food Facts" />
      <View style={{ height: space.md }} />
      <Button
        label={busy ? "Searching" : "Search"}
        disabled={busy || query.trim().length < 2}
        onPress={() => {
          setBusy(true);
          setError(null);
          searchOpenFoodFacts(query.trim())
            .then(setHits)
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Search failed."))
            .finally(() => setBusy(false));
        }}
      />
      <View style={{ height: space.md }} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {(["breakfast", "lunch", "dinner", "snack"] as MealName[]).map((item) => (
          <View key={item} style={{ flex: 1 }}>
            <Button label={item} tone={meal === item ? "primary" : "secondary"} onPress={() => setMeal(item)} />
          </View>
        ))}
      </View>
      {error ? <AppText variant="small">{error}</AppText> : null}
      {hits.length === 0 && !error ? <AppText variant="caption" color={colors.textSecondary}>Results come from Open Food Facts. A miss is a miss, not a guessed food.</AppText> : null}
      {hits.map((hit) => (
        <View key={`${hit.id}-${hit.name}`} style={{ paddingVertical: space.md, gap: 4 }}>
          <AppText variant="h3">{hit.name}</AppText>
          <AppText variant="caption">{hit.brand ?? "No brand"} · {hit.servingLabel} · {Math.round(hit.kcal)} kcal</AppText>
          <Button
            label="Log one serving"
            tone="secondary"
            onPress={() => void logFood({
              day: localDay(new Date(), deviceTimeZone()),
              timezone: deviceTimeZone(),
              meal,
              name: hit.name,
              source: "open_food_facts",
              sourceId: hit.id,
              servings: 1,
              kcal: hit.kcal,
              proteinG: hit.proteinG,
              carbsG: hit.carbsG,
              fatG: hit.fatG,
              fiberG: hit.fiberG,
              sugarG: hit.sugarG,
              sodiumMg: hit.sodiumMg,
            })}
          />
        </View>
      ))}
    </Screen>
  );
}
