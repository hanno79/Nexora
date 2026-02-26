// Utility for checking unauthorized errors - from javascript_log_in_with_replit blueprint
export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  if (status === 401) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  const normalizedMessage = typeof message === "string" ? message.trim().toLowerCase() : "";
  if (normalizedMessage === "unauthorized") {
    return true;
  }

  return normalizedMessage.startsWith("401:");
}
