import { brandConfig } from "@vitacore/brand";

export type FoodHit = {
  id: string;
  name: string;
  brand: string | null;
  servingLabel: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  source: "open_food_facts";
};

type Nutriments = Record<string, number | string | undefined>;

function numberOrNull(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function fromNutriments(nutriments: Nutriments, name: string, brand: string | null, id: string): FoodHit | null {
  const kcal = numberOrNull(nutriments["energy-kcal_100g"]);
  const protein = numberOrNull(nutriments.proteins_100g);
  const carbs = numberOrNull(nutriments.carbohydrates_100g);
  const fat = numberOrNull(nutriments.fat_100g);
  if (kcal == null || protein == null || carbs == null || fat == null || !name) return null;
  const sodiumG = numberOrNull(nutriments.sodium_100g);
  return {
    id,
    name,
    brand,
    servingLabel: "100 g",
    kcal,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    fiberG: numberOrNull(nutriments.fiber_100g),
    sugarG: numberOrNull(nutriments.sugars_100g),
    sodiumMg: sodiumG == null ? null : Math.round(sodiumG * 1000),
    source: "open_food_facts",
  };
}

export async function searchOpenFoodFacts(query: string): Promise<FoodHit[]> {
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("fields", "code,product_name,brands,nutriments");
  const response = await fetch(url, {
    headers: { "User-Agent": brandConfig.openFoodFactsUserAgent },
  });
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}.`);
  const body = (await response.json()) as {
    products?: { code?: string; product_name?: string; brands?: string; nutriments?: Nutriments }[];
  };
  return (body.products ?? [])
    .map((product) =>
      fromNutriments(product.nutriments ?? {}, product.product_name ?? "", product.brands ?? null, product.code ?? product.product_name ?? ""),
    )
    .filter((hit): hit is FoodHit => hit != null);
}

export async function productByBarcode(code: string): Promise<FoodHit | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, {
    headers: { "User-Agent": brandConfig.openFoodFactsUserAgent },
  });
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}.`);
  const body = (await response.json()) as {
    status?: number;
    product?: { code?: string; product_name?: string; brands?: string; nutriments?: Nutriments };
  };
  if (body.status !== 1 || !body.product) return null;
  return fromNutriments(
    body.product.nutriments ?? {},
    body.product.product_name ?? "",
    body.product.brands ?? null,
    body.product.code ?? code,
  );
}
