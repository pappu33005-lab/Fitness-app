import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  deviceTimeZone,
  displayMacro,
  estimateDailyCalories,
  localDay,
  remainingCalories,
  remainingWaterMl,
  sumNutrients,
} from "@vitacore/domain";
import { AppText, Button, Card, ProgressBar, Screen, TextField, WeekStrip } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import {
  addWater,
  deleteFoodLog,
  deleteWaterLog,
  foodsForDay,
  waterEntriesForDay,
  waterForDay,
  type FoodLogRow,
  type MealName,
  type WaterLogRow,
} from "@/data/logs";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

const MEAL_ORDER: MealName[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABEL: Record<MealName, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

function nutritionWeekDays(selected: string, zone: string) {
  const today = localDay(new Date(), zone);
  const anchor = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - 6 + index);
    const key = localDay(date, zone);
    return { key, label: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: zone }), selected: key === selected };
  });
}

export default function NutritionScreen() {
  const router = useRouter();
  const { profile } = useAppState();
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const today = localDay(new Date(), zone);
  const units = profile?.unitSystem ?? "metric";

  const [selected, setSelected] = useState(today);
  const [foods, setFoods] = useState<FoodLogRow[]>([]);
  const [water, setWater] = useState(0);
  const [waterEntries, setWaterEntries] = useState<WaterLogRow[]>([]);
  const [customMl, setCustomMl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([foodsForDay(selected), waterForDay(selected), waterEntriesForDay(selected)])
      .then(([foodRows, waterTotal, entries]) => {
        setFoods(foodRows);
        setWater(waterTotal);
        setWaterEntries(entries);
        setLoaded(true);
      })
      .catch(() => setStatus("This day could not be loaded from the device database."));
  }, [selected]);
  useFocusEffect(load);

  const totals = sumNutrients(
    foods.map((food) => ({
      kcal: food.kcal,
      proteinG: food.protein_g ?? 0,
      carbsG: food.carbs_g ?? 0,
      fatG: food.fat_g ?? 0,
      fiberG: food.fiber_g,
      sugarG: food.sugar_g,
      sodiumMg: food.sodium_mg,
    })),
  );
  const macrosKnown = foods.length > 0 && foods.every((food) => food.protein_g != null && food.carbs_g != null && food.fat_g != null);

  const calorieGoal = profile ? estimateDailyCalories(profile) : { status: "unavailable" as const, reason: "missing_profile" as const, missing: [] };
  const target = calorieGoal.status === "estimated" ? calorieGoal.kcal : null;
  const remaining = remainingCalories(target, totals.kcal);
  const waterTarget = profile?.hydrationTargetMl ?? null;
  const waterRemaining = remainingWaterMl(waterTarget, water);

  const grouped = MEAL_ORDER.map((meal) => ({ meal, entries: foods.filter((food) => food.meal === meal) })).filter((group) => group.entries.length > 0);

  async function quickAddWater(ml: number) {
    setStatus(null);
    try {
      await addWater(selected, zone, ml);
      load();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "That amount could not be saved.");
    }
  }

  async function addCustomWater() {
    const ml = Math.round(Number(customMl));
    setStatus(null);
    try {
      await addWater(selected, zone, ml);
      setCustomMl("");
      load();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Enter a whole number of millilitres greater than zero.");
    }
  }

  async function removeFood(id: string) {
    await deleteFoodLog(id);
    load();
  }

  async function removeWater(id: string) {
    await deleteWaterLog(id);
    load();
  }

  return (
    <Screen>
      <AppText variant="h1">Nutrition</AppText>
      <AppText variant="small" color={colors.textSecondary}>Search uses Open Food Facts. Missing nutrients stay blank rather than guessed.</AppText>
      <View style={{ height: space.lg }} />
      <WeekStrip days={nutritionWeekDays(selected, zone)} onSelect={setSelected} />
      <View style={{ height: space.xl }} />

      <Card>
        <AppText variant="label">{selected === today ? "Today" : selected}</AppText>
        <AppText variant="metric">{foods.length ? Math.round(totals.kcal).toLocaleString("en-US") : "—"}</AppText>
        <AppText variant="small" color={colors.textSecondary}>kcal logged</AppText>
        {target != null ? (
          <>
            <View style={{ height: space.sm }} />
            <ProgressBar progress={target > 0 ? totals.kcal / target : 0} />
            <AppText variant="small">
              {remaining != null && remaining >= 0 ? `${remaining.toLocaleString("en-US")} kcal remaining of ${target.toLocaleString("en-US")}` : `${Math.abs(remaining ?? 0).toLocaleString("en-US")} kcal over ${target.toLocaleString("en-US")}`}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color={colors.textSecondary}>A calorie goal needs age, sex, height, weight, activity level, and a goal set on your profile.</AppText>
        )}
        <View style={{ height: space.sm }} />
        <AppText variant="small">{macrosKnown ? `Protein ${displayMacro(totals.proteinG)} g · Carbs ${displayMacro(totals.carbsG)} g · Fat ${displayMacro(totals.fatG)} g` : foods.length ? "Protein, carbs, and fat stay blank when a logged food did not include them." : "Nothing logged yet."}</AppText>
      </Card>

      <View style={{ height: space.lg }} />
      <Button label="Search food" onPress={() => router.push("/search")} />
      <View style={{ height: space.sm }} />
      <Button label="Scan a barcode" tone="secondary" onPress={() => router.push("/scan")} />
      <View style={{ height: space.sm }} />
      <Button label="Add food manually" tone="secondary" onPress={() => router.push({ pathname: "/food/new", params: { day: selected } })} />
      <View style={{ height: space.sm }} />
      <Button label="Ask the coach" tone="ghost" onPress={() => router.push("/coach")} />

      <View style={{ height: space.xl }} />
      <Card>
        <AppText variant="label">Water</AppText>
        <AppText variant="h2">{water.toLocaleString("en-US")} ml{units === "imperial" ? ` (${Math.round(water / 29.5735)} fl oz)` : ""}</AppText>
        {waterTarget != null ? (
          <>
            <View style={{ height: space.sm }} />
            <ProgressBar progress={waterTarget > 0 ? water / waterTarget : 0} />
            <AppText variant="small">
              {waterRemaining != null && waterRemaining >= 0 ? `${waterRemaining.toLocaleString("en-US")} ml remaining of ${waterTarget.toLocaleString("en-US")}` : `${Math.abs(waterRemaining ?? 0).toLocaleString("en-US")} ml over ${waterTarget.toLocaleString("en-US")}`}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color={colors.textSecondary}>Set a hydration target on your profile to track progress.</AppText>
        )}
        <View style={{ height: space.md }} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {[250, 500].map((ml) => (
            <View key={ml} style={{ flex: 1 }}>
              <Button label={units === "imperial" ? `+${Math.round(ml / 29.5735)} oz` : `+${ml} ml`} tone="secondary" onPress={() => void quickAddWater(ml)} />
            </View>
          ))}
        </View>
        <View style={{ height: space.sm }} />
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <TextField label="Custom amount (ml)" value={customMl} onChangeText={setCustomMl} keyboardType="numeric" placeholder="e.g. 350" />
          </View>
          <Button label="Add" tone="secondary" onPress={() => void addCustomWater()} disabled={customMl.trim().length === 0} />
        </View>
        {status ? <AppText variant="small" color={colors.accent}>{status}</AppText> : null}
        {waterEntries.length > 0 ? (
          <>
            <View style={{ height: space.md }} />
            {waterEntries.map((entry) => (
              <View key={entry.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }}>
                <AppText variant="caption">{entry.ml.toLocaleString("en-US")} ml · {new Date(entry.logged_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</AppText>
                <Button label="Remove" tone="ghost" onPress={() => void removeWater(entry.id)} />
              </View>
            ))}
          </>
        ) : null}
      </Card>

      <View style={{ height: space.xl }} />
      {!loaded ? (
        <AppText variant="small" color={colors.textSecondary}>Loading…</AppText>
      ) : foods.length === 0 ? (
        <AppText variant="small" color={colors.textSecondary}>{selected === today ? "Nothing logged today yet." : "Nothing was logged on this day."}</AppText>
      ) : (
        grouped.map((group) => (
          <View key={group.meal} style={{ marginBottom: space.lg }}>
            <AppText variant="label">{MEAL_LABEL[group.meal]}</AppText>
            {group.entries.map((food) => (
              <View key={food.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="h3">{food.food_name}</AppText>
                  <AppText variant="caption">
                    {Math.round(food.kcal)} kcal · {food.source.replaceAll("_", " ")}
                    {food.notes ? ` · ${food.notes}` : ""}
                  </AppText>
                </View>
                <Button label="Edit" tone="ghost" onPress={() => router.push(`/food/${food.id}`)} />
                <Button label="Delete" tone="ghost" onPress={() => void removeFood(food.id)} />
              </View>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
