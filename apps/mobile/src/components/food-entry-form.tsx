import { useState } from "react";
import { View } from "react-native";
import { sanitizeNutrientInput, sanitizeRequiredNutrientInput } from "@vitacore/domain";
import { AppText, Button, TextField } from "@/components/ui";
import type { MealName } from "@/data/logs";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

export type FoodEntryDraft = {
  meal: MealName;
  name: string;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
  notes: string;
};

export type FoodEntryValues = {
  meal: MealName;
  name: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  notes: string | null;
};

export function blankFoodEntryDraft(meal: MealName = "lunch"): FoodEntryDraft {
  return { meal, name: "", kcal: "", proteinG: "", carbsG: "", fatG: "", fiberG: "", notes: "" };
}

/** A name is required; every numeric field is otherwise handled by sanitizeNutrientInput, so this can never produce NaN. */
export function draftToValues(draft: FoodEntryDraft): FoodEntryValues | null {
  const name = draft.name.trim();
  if (name.length === 0) return null;
  return {
    meal: draft.meal,
    name,
    kcal: sanitizeRequiredNutrientInput(draft.kcal),
    proteinG: sanitizeNutrientInput(draft.proteinG),
    carbsG: sanitizeNutrientInput(draft.carbsG),
    fatG: sanitizeNutrientInput(draft.fatG),
    fiberG: sanitizeNutrientInput(draft.fiberG),
    notes: draft.notes.trim() || null,
  };
}

const MEALS: MealName[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Shared by the manual "Add food" screen and the edit-entry screen. Editing changes the
 * entry's stored totals directly (name, meal, macros, notes) — servings are not part of
 * this form, since only the final per-entry totals are stored locally.
 */
export function FoodEntryForm({
  draft,
  onChange,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  draft: FoodEntryDraft;
  onChange: (next: FoodEntryDraft) => void;
  submitLabel: string;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {MEALS.map((item) => (
          <View key={item} style={{ flex: 1 }}>
            <Button label={item} tone={draft.meal === item ? "primary" : "secondary"} onPress={() => onChange({ ...draft, meal: item })} />
          </View>
        ))}
      </View>
      <TextField label="Food name" value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} placeholder="e.g. Grilled chicken salad" />
      <TextField label="Calories (kcal)" value={draft.kcal} onChangeText={(kcal) => onChange({ ...draft, kcal })} keyboardType="numeric" placeholder="0" />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField label="Protein (g)" value={draft.proteinG} onChangeText={(proteinG) => onChange({ ...draft, proteinG })} keyboardType="decimal-pad" placeholder="optional" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Carbs (g)" value={draft.carbsG} onChangeText={(carbsG) => onChange({ ...draft, carbsG })} keyboardType="decimal-pad" placeholder="optional" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Fat (g)" value={draft.fatG} onChangeText={(fatG) => onChange({ ...draft, fatG })} keyboardType="decimal-pad" placeholder="optional" />
        </View>
      </View>
      <TextField label="Fiber (g)" value={draft.fiberG} onChangeText={(fiberG) => onChange({ ...draft, fiberG })} keyboardType="decimal-pad" placeholder="optional" />
      <TextField label="Notes" value={draft.notes} onChangeText={(notes) => onChange({ ...draft, notes })} placeholder="optional" />
      {error ? <AppText variant="small" color={colors.accent}>{error}</AppText> : null}
      <Button label={busy ? "Saving…" : submitLabel} onPress={onSubmit} disabled={busy || draft.name.trim().length === 0} />
    </View>
  );
}
