import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deviceTimeZone, localDay } from "@vitacore/domain";
import { AppText, Button, Screen, SearchBar } from "@/components/ui";
import { logFood, type MealName } from "@/data/logs";
import { searchOpenFoodFacts, type FoodHit } from "@/nutrition/openFoodFacts";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

function isMealName(value: string | string[] | undefined): value is MealName {
  const meal = Array.isArray(value) ? value[0] : value;
  return meal === "breakfast" || meal === "lunch" || meal === "dinner" || meal === "snack";
}

export default function SearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ meal?: string }>();
  const meal: MealName = isMealName(params.meal) ? params.meal : "lunch";
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen>
      <AppText variant="h1">Search food</AppText>
      <AppText variant="caption">Open Food Facts · logging for {meal}</AppText>
      <View style={{ height: space.md }} />
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search Open Food Facts" />
      <View style={{ height: space.sm }} />
      <Button
        label={busy ? "Searching" : "Search"}
        disabled={busy || query.trim().length < 2}
        onPress={() => {
          setBusy(true);
          setError(null);
          void searchOpenFoodFacts(query.trim())
            .then(setHits)
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Search failed."))
            .finally(() => setBusy(false));
        }}
      />
      <View style={{ height: space.lg }} />
      {error ? <AppText variant="small">{error}</AppText> : null}
      {hits.length === 0 && !error ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Results come from Open Food Facts. Nutrient values are per 100 g unless a product serving size is known in grams.
        </AppText>
      ) : null}
      {hits.map((hit) => (
        <View key={`${hit.id}-${hit.name}`} style={{ paddingVertical: space.md, gap: 4 }}>
          <AppText variant="h3">{hit.name}</AppText>
          <AppText variant="caption">
            {hit.brand ?? "No brand"} · {hit.servingLabel} · {Math.round(hit.kcal)} kcal
          </AppText>
          <Button
            label={loggingId === hit.id ? "Saving…" : `Log ${hit.servingLabel}`}
            tone="secondary"
            disabled={loggingId != null}
            onPress={() => {
              if (loggingId) return;
              setLoggingId(hit.id);
              setError(null);
              void logFood({
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
              })
                .then(() => router.back())
                .catch((reason: unknown) => {
                  setLoggingId(null);
                  setError(reason instanceof Error ? reason.message : "This food could not be saved.");
                });
            }}
          />
        </View>
      ))}
    </Screen>
  );
}
