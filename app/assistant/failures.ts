export function assistantFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/timed out|timeout|etimedout|aborterror/i.test(message)) {
    return "That request timed out while checking football data or bookmaker markets. Your conversation is still here; please try again.";
  }
  if (/network|fetch failed|temporarily unavailable|\b429\b|\b502\b|\b503\b|\b504\b/i.test(message)) {
    return "A football data or bookmaker service is temporarily unavailable. Your conversation is still here; please try again shortly.";
  }
  return "I hit an unexpected problem while handling that request. Your conversation is still here; try again or rephrase your request.";
}
