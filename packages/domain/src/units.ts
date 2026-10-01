import type { UnitSystem } from "./profile";

export function kgToLb(kg: number): number {
  return kg * 2.2046226218;
}

export function lbToKg(lb: number): number {
  return lb / 2.2046226218;
}

export function cmToTotalInches(cm: number): number {
  return cm / 2.54;
}

export function cmToFeetAndInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cmToTotalInches(cm));
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export function feetAndInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function metersToKilometers(meters: number): number {
  return meters / 1000;
}

export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function mlToFluidOunces(ml: number): number {
  return ml / 29.5735295625;
}

export function fluidOuncesToMl(ounces: number): number {
  return ounces * 29.5735295625;
}

export function formatWeight(kg: number, system: UnitSystem): string {
  if (system === "imperial") return `${kgToLb(kg).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

export function formatHeight(cm: number, system: UnitSystem): string {
  if (system === "imperial") {
    const { feet, inches } = cmToFeetAndInches(cm);
    return `${feet} ft ${inches} in`;
  }
  return `${Math.round(cm)} cm`;
}

export function formatDistance(meters: number, system: UnitSystem): string {
  if (system === "imperial") return `${metersToMiles(meters).toFixed(2)} mi`;
  return `${metersToKilometers(meters).toFixed(2)} km`;
}

export function formatVolume(ml: number, system: UnitSystem): string {
  if (system === "imperial") return `${Math.round(mlToFluidOunces(ml))} fl oz`;
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)} L`;
  return `${Math.round(ml)} ml`;
}

export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function formatClockDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remain).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatPace(secondsPerKilometer: number, system: UnitSystem): string {
  const seconds = system === "imperial" ? secondsPerKilometer * 1.609344 : secondsPerKilometer;
  if (!Number.isFinite(seconds) || seconds <= 0) return "–";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remain = rounded % 60;
  const unit = system === "imperial" ? "/mi" : "/km";
  return `${minutes}:${String(remain).padStart(2, "0")}${unit}`;
}
