import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request } from "node:https";

export type SupportedImageType = "image/jpeg" | "image/png";
export interface ValidatedMedia { contentType: SupportedImageType; contentLength?: number }
export interface ProbeResponse { status: number; headers: Record<string, string | undefined> }

interface ValidatorDependencies {
  resolve?: (hostname: string) => Promise<string[]>;
  probe?: (
    url: URL,
    pinnedAddress: string,
    signal?: AbortSignal,
    method?: "GET",
  ) => Promise<ProbeResponse>;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class MediaValidator {
  readonly #resolve: (hostname: string) => Promise<string[]>;
  readonly #probe: (
    url: URL,
    pinnedAddress: string,
    signal?: AbortSignal,
    method?: "GET",
  ) => Promise<ProbeResponse>;

  constructor(dependencies: ValidatorDependencies = {}) {
    this.#resolve = dependencies.resolve ?? resolvePublicAddresses;
    this.#probe = dependencies.probe ?? probePinnedHttps;
  }

  async validate(rawUrl: string, signal?: AbortSignal): Promise<ValidatedMedia> {
    let current = parseSafeHttpsUrl(rawUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const addresses = isIP(current.hostname)
        ? [current.hostname]
        : await this.#resolve(current.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
        throw new Error("image URL ชี้ไป private หรือ reserved network ซึ่งไม่อนุญาต");
      }
      const response = await this.#probe(current, addresses[0]!, signal, "GET");
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location || redirects === MAX_REDIRECTS) throw new Error("image URL redirect มากเกินไปหรือไม่สมบูรณ์");
        current = parseSafeHttpsUrl(new URL(location, current).href);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error("เปิด image URL ไม่สำเร็จ");
      const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/jpeg" && contentType !== "image/png") {
        throw new Error("ไฟล์ต้องเป็น JPEG หรือ PNG เท่านั้น");
      }
      const contentLength = parseRangeTotal(response.headers["content-range"])
        ?? parseContentLength(response.headers["content-length"]);
      if (contentLength !== undefined && contentLength > MAX_BYTES) throw new Error("ไฟล์ภาพต้องไม่เกิน 8 MB");
      return { contentType, contentLength };
    }
    throw new Error("ตรวจ image URL ไม่สำเร็จ");
  }
}

function parseSafeHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("image URL ไม่ถูกต้อง"); }
  if (url.protocol !== "https:") throw new Error("image URL ต้องใช้ HTTPS");
  if (url.username || url.password || !url.hostname) throw new Error("image URL ไม่ถูกต้อง");
  if (url.port && url.port !== "443") throw new Error("image URL ต้องใช้ HTTPS port มาตรฐาน");
  return url;
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("ขนาดไฟล์ภาพไม่ถูกต้อง");
  return parsed;
}

function parseRangeTotal(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes\s+\d+-\d+\/(\d+)$/u.exec(value.trim());
  if (!match) throw new Error("ขนาดไฟล์ภาพไม่ถูกต้อง");
  return parseContentLength(match[1]);
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

export function isPrivateOrReservedIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;
    if (a === undefined || b === undefined || c === undefined) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")
      || /^fe[89ab]/u.test(lower) || lower.startsWith("ff") || lower.startsWith("2001:db8:")
      || lower.startsWith("100:") || lower.startsWith("::ffff:");
  }
  return true;
}

function probePinnedHttps(
  url: URL,
  pinnedAddress: string,
  signal?: AbortSignal,
  method: "GET" = "GET",
): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: "https:",
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      method,
      path: `${url.pathname}${url.search}`,
      headers: {
        accept: "image/jpeg,image/png",
        range: "bytes=0-0",
        "user-agent": "PiR2-Academy-Instagram-Publisher/0.1",
      },
      lookup: createPinnedLookup(pinnedAddress),
      signal,
      timeout: 10_000,
    }, (response) => {
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
      resolve({ status: response.statusCode ?? 0, headers });
      response.destroy();
    });
    req.once("timeout", () => req.destroy(new Error("image URL timeout")));
    req.once("error", () => reject(new Error("เปิด image URL ไม่สำเร็จ")));
    req.end();
  });
}

export function createPinnedLookup(pinnedAddress: string): LookupFunction {
  const family = isIP(pinnedAddress);
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: pinnedAddress, family }]);
      return;
    }
    callback(null, pinnedAddress, family);
  };
}
