import brand from "../brand.json";

/**
 * Single source for the product name and store identifiers.
 * Screens and native config import this module instead of typing the name.
 */
export const brandConfig = brand;

export type BrandConfig = typeof brand;
