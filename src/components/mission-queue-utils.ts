type DispatchErrorResponse = {
  error?: string;
  warning?: string;
  message?: string;
  details?: string;
  otherOrchestrators?: Array<{ name?: string }>;
};

export function getDispatchFailureMessage(status: number, bodyText: string): string {
  const fallback = `Dispatch failed (${status})`;
  const trimmed = bodyText.trim();

  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as DispatchErrorResponse;
    if (parsed.message) return parsed.message;
    if (parsed.warning) return parsed.warning;
    if (parsed.details) return parsed.details;
    if (parsed.error) return parsed.error;

    if (status === 409 && Array.isArray(parsed.otherOrchestrators) && parsed.otherOrchestrators.length > 0) {
      const names = parsed.otherOrchestrators
        .map((orchestrator) => orchestrator.name)
        .filter((name): name is string => Boolean(name));

      if (names.length > 0) {
        return `Other orchestrators available: ${names.join(', ')}`;
      }
    }
  } catch {
    // Fall back to raw text below.
  }

  return trimmed || fallback;
}