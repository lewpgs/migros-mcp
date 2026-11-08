import https from "node:https";
import axios from "axios";
import type { AxiosInstance } from "axios";

/**
 * The HTTP layer for the calls this package makes itself, next to the ones
 * migros-api-wrapper makes. Tests swap it for a fake, so nothing goes out.
 *
 * www.migros.ch sits behind Akamai, which turns away requests whose header
 * names look wrong. axios writes the standard names with capitals, like the
 * wrapper does; keep using it for www.migros.ch rather than `fetch`.
 */

export const MIGROS_BASE = "https://www.migros.ch";

export interface HttpResponse {
  status: number;
  data: unknown;
  /** The Location header of a redirect, if any. Redirects are not followed. */
  location?: string;
}

export type Post = (url: string, body: unknown, headers: Record<string, string>) => Promise<HttpResponse>;
export type Get = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

let _client: AxiosInstance | null = null;

/** Same transport as migros-api-wrapper's anonymous calls (TLS 1.3), with a timeout. */
function client(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      httpsAgent: new https.Agent({ minVersion: "TLSv1.3" }),
      timeout: 10_000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
  }
  return _client;
}

function locationOf(headers: unknown): string | undefined {
  const loc = (headers as Record<string, unknown> | undefined)?.location;
  return typeof loc === "string" ? loc : undefined;
}

export const defaultPost: Post = async (url, body, headers) => {
  const r = await client().post(url, body, { headers });
  return { status: r.status, data: r.data, location: locationOf(r.headers) };
};

export const defaultGet: Get = async (url, headers) => {
  const r = await client().get(url, { headers });
  return { status: r.status, data: r.data, location: locationOf(r.headers) };
};

/** Headers for an anonymous www.migros.ch API call with the guest token. */
export function migrosHeaders(token: string, language?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    leshopch: token,
  };
  // `language` comes from the AI as free text: only pass a plain code on as a header.
  if (language && /^[a-z]{2}$/.test(language)) headers["migros-language"] = language;
  // Honour the wrapper's own User-Agent override, like its anonymous calls do.
  const ua = process.env.MIGROS_API_WRAPPER_USERAGENT;
  if (ua) headers["User-Agent"] = ua;
  return headers;
}

function failed(method: string, path: string, status: number): Error {
  return new Error(`${method} ${path} -> ${status}`);
}

/** POST to www.migros.ch and return the JSON. Throws on a non-2xx answer. */
export async function postMigros(post: Post, path: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const r = await post(`${MIGROS_BASE}${path}`, body, headers);
  if (r.status < 200 || r.status >= 300) throw failed("POST", path, r.status);
  return r.data;
}

/** GET from www.migros.ch and return the JSON. Throws on a non-2xx answer. */
export async function getMigros(get: Get, path: string, headers: Record<string, string>): Promise<unknown> {
  const r = await get(`${MIGROS_BASE}${path}`, headers);
  if (r.status < 200 || r.status >= 300) throw failed("GET", path.split("?")[0], r.status);
  return r.data;
}
