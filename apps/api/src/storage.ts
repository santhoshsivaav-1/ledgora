import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppEnv } from './env.ts';

export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
}

/** Where file bytes live. The database only keeps the key (change 1.22). */
export interface Storage {
  readonly driver: 's3' | 'local';
  signUpload(key: string, contentType: string): Promise<SignedUpload>;
  signDownload(key: string, fileName: string, expiresInSeconds: number): Promise<string>;
  /** Size in bytes of a stored object, or null when nothing was uploaded to that key. */
  size(key: string): Promise<number | null>;
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** Local driver only: check the signature on a /v1/storage/local URL. */
  verify(key: string, action: 'put' | 'get', exp: number, sig: string): boolean;
}

export function s3Storage(env: AppEnv): Storage {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  const Bucket = env.S3_BUCKET!;
  return {
    driver: 's3',
    async signUpload(key, contentType) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        { expiresIn: 600 },
      );
      return { url, headers: { 'content-type': contentType } };
    },
    signDownload: (key, fileName, expiresInSeconds) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
        }),
        { expiresIn: expiresInSeconds },
      ),
    async size(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return head.ContentLength ?? 0;
      } catch {
        return null;
      }
    },
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return (await res.Body?.transformToByteArray()) ?? null;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    verify: () => false,
  };
}

/** Development stand-in for S3: files on disk, URLs signed with an HMAC so they expire like the real thing. */
export function localStorage(env: AppEnv, publicBase: string): Storage {
  const root = path.resolve(env.LOCAL_FILES_DIR);
  const full = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('bad storage key');
    return p;
  };
  const sign = (key: string, action: string, exp: number) =>
    createHmac('sha256', env.FILE_SIGNING_SECRET).update(`${action}:${key}:${exp}`).digest('hex');
  const url = (key: string, action: 'put' | 'get', ttl: number, extra = '') => {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return `${publicBase}/v1/storage/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, action, exp)}${extra}`;
  };
  return {
    driver: 'local',
    signUpload: async (key, contentType) => ({
      url: url(key, 'put', 600),
      headers: { 'content-type': contentType },
    }),
    signDownload: async (key, fileName, ttl) =>
      url(key, 'get', ttl, `&name=${encodeURIComponent(fileName)}`),
    async size(key) {
      try {
        return (await stat(full(key))).size;
      } catch {
        return null;
      }
    },
    async put(key, body) {
      const p = full(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(full(key)));
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(full(key), { force: true });
    },
    verify(key, action, exp, sig) {
      if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
      const want = Buffer.from(sign(key, action, exp));
      const got = Buffer.from(sig);
      return want.length === got.length && timingSafeEqual(want, got);
    },
  };
}

export function createStorage(env: AppEnv): Storage {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) return s3Storage(env);
  return localStorage(env, `http://localhost:${env.API_LISTEN_PORT}`);
}
