import { createRequire } from "node:module";
import { extractXPostId, isValidXPostUrl, parseXConversionRequest } from "./x-reply-helper.mjs";

const require = createRequire(import.meta.url);
const maxImages = 4;
const maxImageBytes = 8 * 1024 * 1024;

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&mdash;", "—");
}

function plainText(value) {
  return decodeEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function distinctText(parts) {
  const seen = new Set();
  return parts.map((part) => String(part || "").trim()).filter((part) => {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
}

export function extractXEmbedText(html) {
  const paragraphs = [...String(html || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => plainText(match[1])).filter(Boolean);
  return paragraphs.length ? paragraphs.join("\n") : plainText(html);
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forward = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i").exec(html)?.[1];
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[1];
  return decodeEntities(forward || reverse || "").trim();
}

async function directPostDescription(tweetUrl, fetchImpl) {
  try {
    const response = await fetchImpl(tweetUrl, { redirect: "follow", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; OddsAura/1.0; +https://oddsaura.site)" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const html = await response.text();
    return metaContent(html, "og:description") || metaContent(html, "twitter:description") || null;
  } catch { return null; }
}

function safePhotoUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".twimg.com")) ? url.toString() : null;
  } catch { return null; }
}

export async function readFxPost(postId, fetchImpl = fetch) {
  if (!/^\d+$/.test(String(postId || ""))) return null;
  try {
    const response = await fetchImpl(`https://api.fxtwitter.com/2/status/${postId}`, { headers: { accept: "application/json", "user-agent": "OddsAura/1.0 (+https://oddsaura.site)" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const payload = await response.json();
    const status = payload?.status || payload?.tweet || payload;
    const rawPhotos = Array.isArray(status?.media?.photos) ? status.media.photos : Array.isArray(status?.media?.all) ? status.media.all.filter((item) => item?.type === "photo" || item?.type === "image") : [];
    const photos = rawPhotos.map((item) => ({ url: safePhotoUrl(item?.url), altText: String(item?.altText || item?.alt_text || "").trim() })).filter((item) => item.url).slice(0, maxImages);
    return { text: String(status?.text || "").trim(), authorName: String(status?.author?.name || "").trim() || null, authorUrl: String(status?.author?.url || "").trim() || null, photos };
  } catch { return null; }
}

async function fetchImage(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: "follow", headers: { accept: "image/*", "user-agent": "OddsAura/1.0 (+https://oddsaura.site)" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) return null;
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxImageBytes) return null;
  const data = Buffer.from(await response.arrayBuffer());
  return data.length && data.length <= maxImageBytes ? data : null;
}

export async function recognizeXPhotos(photos, fetchImpl = fetch) {
  const images = [];
  for (const photo of (photos ?? []).slice(0, maxImages)) {
    const image = await fetchImage(photo.url, fetchImpl).catch(() => null);
    if (image) images.push(image);
  }
  if (!images.length) return "";
  let worker;
  try {
    const [{ createWorker }, languageData] = await Promise.all([import("tesseract.js"), Promise.resolve(require("@tesseract.js-data/eng"))]);
    worker = await createWorker("eng", 1, { langPath: languageData.langPath, gzip: languageData.gzip, cacheMethod: "readOnly" });
    const results = [];
    for (const image of images) {
      const recognized = await worker.recognize(image);
      if (recognized?.data?.text) results.push(recognized.data.text);
    }
    return distinctText(results);
  } catch { return ""; }
  finally { if (worker) await worker.terminate().catch(() => undefined); }
}

export async function readXPost(tweetUrl, fetchImpl = fetch, options = {}) {
  const value = String(tweetUrl || "").trim();
  if (!isValidXPostUrl(value)) throw new Error("Enter a valid public X post link.");
  const postId = extractXPostId(value);
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", value);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");
  endpoint.searchParams.set("hide_thread", "true");
  let payload = null;
  try {
    const response = await fetchImpl(endpoint, { headers: { accept: "application/json", "user-agent": "OddsAura/1.0 (+https://oddsaura.site)" }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) payload = await response.json();
  } catch { payload = null; }
  const embedHtml = String(payload?.html || "");
  let requestText = extractXEmbedText(embedHtml);
  if (!requestText) requestText = await directPostDescription(value, fetchImpl) || "";
  let detected = parseXConversionRequest(requestText);
  const embedHasMedia = /pic\.twitter\.com|\/photo\//i.test(embedHtml);
  let fxPost = null; let ocrText = "";
  if (postId && (embedHasMedia || !requestText || !detected.codes.length)) {
    const fxReader = options.fxReader || readFxPost;
    fxPost = await fxReader(postId, fetchImpl).catch(() => null);
    const altText = distinctText((fxPost?.photos ?? []).map((photo) => photo.altText));
    const mediaText = distinctText([fxPost?.text, altText]);
    if (mediaText) requestText = distinctText([requestText, mediaText]);
    detected = parseXConversionRequest(requestText);
    if (fxPost?.photos?.length) {
      const ocrReader = options.ocrReader || recognizeXPhotos;
      ocrText = await ocrReader(fxPost.photos, fetchImpl).catch(() => "");
      if (ocrText) requestText = distinctText([requestText, ocrText]);
    }
  }
  if (!requestText) throw new Error("X did not expose this post. Paste its text or code lines instead.");
  detected = parseXConversionRequest(requestText);
  return { tweetUrl: value, postId, requestText: requestText.slice(0, 4_000), authorName: String(payload?.author_name || fxPost?.authorName || "").trim() || null, authorUrl: String(payload?.author_url || fxPost?.authorUrl || "").trim() || null, mediaDetected: embedHasMedia || Boolean(fxPost?.photos?.length), ocrUsed: Boolean(ocrText), detected };
}
