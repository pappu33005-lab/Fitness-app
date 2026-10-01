export type HealthConnectionState = "ready" | "permission_required" | "denied" | "unavailable";

export type NextActionCode =
  | "connect_health"
  | "health_denied"
  | "log_meal"
  | "start_activity"
  | "review_today";

export function recommendNextAction(input: {
  platform: "ios" | "android" | "web" | "other";
  health: HealthConnectionState;
  hasMealToday: boolean;
  hasActivityToday: boolean;
}): NextActionCode {
  const canConnectHealth = input.platform === "ios" || input.platform === "android";
  if (canConnectHealth && input.health === "permission_required") return "connect_health";
  if (canConnectHealth && input.health === "unavailable") return "connect_health";
  if (canConnectHealth && input.health === "denied") return "health_denied";
  if (!input.hasMealToday) return "log_meal";
  if (!input.hasActivityToday) return "start_activity";
  return "review_today";
}
