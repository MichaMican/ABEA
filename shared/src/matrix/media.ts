import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { useMatrixClient } from "./MatrixContext";
import { decryptAttachment, encryptAttachment, type EncryptedFile } from "../lib/attachments";

/**
 * Matrix v1.11+ requires authenticated media downloads, which cannot be done with a plain
 * <img src>. We fetch media with the access token and expose it as an object URL.
 */
const cache = new Map<string, Promise<string>>();
const MAX_ENTRIES = 400;

export interface MediaOptions {
  width?: number;
  height?: number;
  method?: "crop" | "scale";
  /** Encryption info for media in end-to-end encrypted rooms. */
  file?: EncryptedFile;
  mimetype?: string;
}

function cacheKey(mxc: string, opts?: MediaOptions): string {
  if (opts?.file) return `enc:${mxc}`;
  return opts?.width ? `${mxc}#${opts.width}x${opts.height ?? opts.width}:${opts.method ?? "crop"}` : mxc;
}

async function fetchRaw(client: MatrixClient, mxc: string): Promise<ArrayBuffer> {
  const token = client.getAccessToken();
  const authed = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
  if (authed) {
    const res = await fetch(authed, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (res?.ok) return res.arrayBuffer();
  }
  const legacy = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, false);
  if (legacy) {
    const res = await fetch(legacy);
    if (res.ok) return res.arrayBuffer();
  }
  throw new Error(`Failed to load media ${mxc}`);
}

async function fetchMedia(client: MatrixClient, mxc: string, opts?: MediaOptions): Promise<string> {
  if (opts?.file) {
    const cipher = await fetchRaw(client, opts.file.url);
    const plain = await decryptAttachment(cipher, opts.file);
    return URL.createObjectURL(new Blob([plain], { type: opts.mimetype || "application/octet-stream" }));
  }
  const w = opts?.width;
  const h = opts?.height ?? opts?.width;
  const method = opts?.method ?? "crop";
  const token = client.getAccessToken();

  const authed = client.mxcUrlToHttp(mxc, w, h, w ? method : undefined, false, true, true);
  if (authed) {
    try {
      const res = await fetch(authed, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) return URL.createObjectURL(await res.blob());
    } catch {
      // try legacy media endpoints below
    }
  }

  const legacy = client.mxcUrlToHttp(mxc, w, h, w ? method : undefined, false, true, false);
  if (legacy) {
    const res = await fetch(legacy);
    if (res.ok) return URL.createObjectURL(await res.blob());
  }

  // Thumbnails may not exist for some media (e.g. GIFs, SVG) – fall back to the original.
  if (w) return fetchMedia(client, mxc);
  throw new Error(`Failed to load media ${mxc}`);
}

export function getMediaUrl(client: MatrixClient, mxc: string, opts?: MediaOptions): Promise<string> {
  const key = cacheKey(mxc, opts);
  let entry = cache.get(key);
  if (!entry) {
    entry = fetchMedia(client, mxc, opts);
    entry.catch(() => cache.delete(key));
    cache.set(key, entry);
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) {
        const p = cache.get(oldest);
        cache.delete(oldest);
        p?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
      }
    }
  }
  return entry;
}

export function useMediaUrl(mxc: string | null | undefined, opts?: MediaOptions): string | null {
  const client = useMatrixClient();
  const key = mxc ? cacheKey(mxc, opts) : null;
  const [state, setState] = useState<{ key: string | null; url: string | null }>({ key: null, url: null });

  useEffect(() => {
    if (!mxc || !mxc.startsWith("mxc://")) return;
    let cancelled = false;
    getMediaUrl(client, mxc, opts)
      .then((url) => !cancelled && setState({ key: cacheKey(mxc, opts), url }))
      .catch(() => !cancelled && setState({ key: cacheKey(mxc, opts), url: null }));
    return () => {
      cancelled = true;
    };
  }, [client, key]);

  return state.key === key ? state.url : null;
}

export async function downloadMedia(
  client: MatrixClient,
  mxc: string,
  filename: string,
  opts?: Pick<MediaOptions, "file" | "mimetype">,
): Promise<void> {
  const url = await getMediaUrl(client, mxc, opts);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface UploadedImage {
  url: string;
  info: { w: number; h: number; mimetype: string; size: number };
}

export function readImageSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ w: 0, h: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Downscale large avatars before upload so profile pictures stay small and square. */
export async function prepareAvatar(file: File, size = 512): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const target = Math.min(size, side);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadAvatar(client: MatrixClient, file: File): Promise<string> {
  const blob = await prepareAvatar(file);
  const res = await client.uploadContent(blob, {
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    type: blob.type || file.type,
  });
  return res.content_uri;
}

/** Uploads a file, encrypting it first when the target room is end-to-end encrypted. */
export async function uploadFile(
  client: MatrixClient,
  file: Blob,
  name: string,
  encrypted: boolean,
  onProgress?: (fraction: number) => void,
): Promise<{ url?: string; file?: EncryptedFile }> {
  const progressHandler = onProgress
    ? ({ loaded, total }: { loaded: number; total: number }) => onProgress(total ? loaded / total : 0)
    : undefined;
  if (!encrypted) {
    const res = await client.uploadContent(file, { name, type: file.type, progressHandler });
    return { url: res.content_uri };
  }
  const { data, info } = await encryptAttachment(await file.arrayBuffer());
  const res = await client.uploadContent(new Blob([data], { type: "application/octet-stream" }), {
    name: "encrypted",
    type: "application/octet-stream",
    includeFilename: false,
    progressHandler,
  });
  return { file: { ...info, url: res.content_uri } };
}
