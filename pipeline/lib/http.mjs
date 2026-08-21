const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(url, status, statusText) {
    super(`${status} ${statusText}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
  }
}

export async function fetchJson(url, { retries = 2, timeoutMs = 12_000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json,text/plain,*/*",
          "accept-language": "en-GB,en;q=0.8",
          "cache-control": "no-cache",
          "user-agent": "Mozilla/5.0 (compatible; OddsAuraData/0.3; +https://github.com/mensahenoch020-sketch/Oddsaura)",
          ...headers,
        },
      });
      if (!response.ok) throw new HttpError(url, response.status, response.statusText);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) break;
      if (attempt < retries) await wait(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof HttpError) throw lastError;
  throw new Error(`Could not fetch ${url}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

export { wait };
