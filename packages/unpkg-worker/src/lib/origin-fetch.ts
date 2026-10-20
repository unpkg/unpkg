import {
  arrayBufferToBase64,
  getContentLength,
  parseContentDigest,
  sha256Base64,
  type ContentDigest,
} from "./cache-utils.ts";

export interface OriginFetchOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  fetchTimeoutMs?: number;
  bufferThresholdBytes?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export const DEFAULT_BUFFER_THRESHOLD_BYTES = 4 * 1024 * 1024;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export class OriginFetchError extends Error {
  attempts: number;

  constructor(message: string, attempts: number, cause?: unknown) {
    super(message);
    this.name = "OriginFetchError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

// Internal marker set on responses returned by the file-fetch helpers.
// "verified" means the body is fully verified (or buffer-backed, so it
// cannot fail mid-stream); "pending" means a streamed body is still being
// verified and must not be written to an outer cache layer yet. Consumers
// that forward the response must strip this header before serving.
export const BODY_VERIFICATION_HEADER = "X-Unpkg-Body-Verification";

export function markBodyVerification(response: Response, pendingVerification: boolean): Response {
  response.headers.set(BODY_VERIFICATION_HEADER, pendingVerification ? "pending" : "verified");
  return response;
}

export interface VerifiedResponse {
  response: Response;
  // Settles when the body has been fully verified. Rejects if verification
  // ultimately failed; cache writers must evict on rejection.
  done: Promise<void>;
  // False when a body was served without a matching digest. Such bodies are
  // valid to serve (length was verified) but must never be cached.
  bodyVerified: boolean;
  // True when the body is a live stream that can still fail verification;
  // false when it is buffer-backed and final.
  streamed: boolean;
}

interface ResolvedOptions {
  maxAttempts: number;
  retryDelayMs: number;
  fetchTimeoutMs: number;
  bufferThresholdBytes: number;
  fetchFn: typeof fetch;
  sleepFn: (ms: number) => Promise<void>;
}

function resolveOptions(options: OriginFetchOptions = {}): ResolvedOptions {
  return {
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    fetchTimeoutMs: options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    bufferThresholdBytes: options.bufferThresholdBytes ?? DEFAULT_BUFFER_THRESHOLD_BYTES,
    // Call through globalThis so the global fetch keeps its correct `this`
    // binding; extracting it unbound throws "Illegal invocation" in Workers.
    fetchFn:
      options.fetchFn ?? (((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch),
    sleepFn: options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

interface DigestState {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  result: Promise<string>;
}

function createDigestState(): DigestState | null {
  let ctor = (
    globalThis.crypto as unknown as {
      DigestStream?: new (algorithm: string) => {
        // In the Workers runtime a DigestStream is itself a WritableStream.
        getWriter: () => WritableStreamDefaultWriter<Uint8Array>;
        digest: Promise<ArrayBuffer>;
      };
    }
  ).DigestStream;

  if (typeof ctor !== "function") {
    return null;
  }

  try {
    let stream = new ctor("SHA-256");
    let result = stream.digest.then((buffer) => arrayBufferToBase64(buffer));
    // The result is only awaited when a stream finishes cleanly; guard
    // against an unhandled rejection when one is abandoned mid-flight.
    void result.catch(() => {});
    return {
      writer: stream.getWriter(),
      result,
    };
  } catch {
    return null;
  }
}

// Incremental length + digest verification over a streamed body. State is
// O(1): a counter plus the runtime's native digest stream, when available.
class IncrementalVerifier {
  private expectedLength: number | null;
  private expectedDigest: ContentDigest | null;
  private digestState: DigestState | null;
  private count = 0;

  constructor(headers: Headers) {
    this.expectedLength = getContentLength(headers);
    this.expectedDigest = parseContentDigest(headers);
    this.digestState =
      this.expectedDigest != null && this.expectedDigest.algorithm === "sha256"
        ? createDigestState()
        : null;
  }

  async update(chunk: Uint8Array): Promise<void> {
    this.count += chunk.byteLength;

    if (this.digestState != null) {
      try {
        await this.digestState.writer.write(chunk);
      } catch {
        // Digest verification is best-effort while streaming; length
        // verification (the truncation check) continues regardless.
        this.digestState = null;
      }
    }
  }

  async finish(): Promise<boolean> {
    if (this.expectedLength != null && this.count !== this.expectedLength) {
      return false;
    }

    if (this.digestState != null && this.expectedDigest != null) {
      try {
        await this.digestState.writer.close();
        let actual = await this.digestState.result;
        if (actual !== this.expectedDigest.hash) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }
}

// Wraps a body stream with end-of-stream verification. On mismatch the
// stream errors (rather than closing cleanly) and `onFailure` runs, so a
// known-bad body is neither accepted as a successful response nor left in
// a cache.
export function wrapWithVerificationAudit(
  body: ReadableStream<Uint8Array>,
  headers: Headers,
  onFailure: () => void
): ReadableStream<Uint8Array> {
  let verifier = new IncrementalVerifier(headers);

  let audit = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      await verifier.update(chunk);
      controller.enqueue(chunk);
    },
    async flush() {
      let ok = await verifier.finish();
      if (!ok) {
        onFailure();
        throw new Error("Cached body failed length/digest verification");
      }
    },
  });

  return body.pipeThrough(audit);
}

function createResumableStream(
  firstResponse: Response,
  makeRequest: () => Promise<Request> | Request,
  options: ResolvedOptions,
  attemptsUsed: number
): { stream: ReadableStream<Uint8Array>; done: Promise<void> } {
  let expectedLength = getContentLength(firstResponse.headers);
  let expectedDigest = firstResponse.headers.get("Content-Digest");
  // A null body is an empty body; give it a reader so the EOF path below
  // handles it instead of spending another attempt.
  let firstBody: ReadableStream<Uint8Array> =
    firstResponse.body ??
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = firstBody.getReader();
  let verifier = new IncrementalVerifier(firstResponse.headers);
  let sent = 0;
  let skip = 0;
  let cancelled = false;
  let lastError: unknown = null;

  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  let done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => {});

  async function startAttempt(): Promise<void> {
    while (attemptsUsed < options.maxAttempts) {
      attemptsUsed += 1;
      await options.sleepFn(options.retryDelayMs);

      let response: Response;
      try {
        response = await options.fetchFn(await makeRequest(), {
          signal: AbortSignal.timeout(options.fetchTimeoutMs),
        });
      } catch (error) {
        lastError = error;
        continue;
      }

      if (response.status >= 500) {
        lastError = new Error(`Origin responded ${response.status} during resume`);
        await response.body?.cancel().catch(() => {});
        continue;
      }
      if (!response.ok) {
        throw new Error(`Origin responded ${response.status} during resume`);
      }

      if (sent === 0) {
        expectedLength = getContentLength(response.headers);
        expectedDigest = response.headers.get("Content-Digest");
        verifier = new IncrementalVerifier(response.headers);
      } else if (
        getContentLength(response.headers) !== expectedLength ||
        response.headers.get("Content-Digest") !== expectedDigest
      ) {
        // The content changed between attempts. Splicing two different
        // bodies would produce a corrupt hybrid, so fail instead.
        throw new Error("Origin content changed between attempts; cannot resume");
      }

      reader = response.body != null ? response.body.getReader() : null;
      skip = sent;
      return;
    }

    throw new OriginFetchError("Origin fetch failed after all attempts", attemptsUsed, lastError);
  }

  let stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          for (;;) {
            if (cancelled) {
              return;
            }

            if (reader == null) {
              await startAttempt();
              if (reader == null) {
                // An attempt with an empty body: treat as its EOF.
                if (expectedLength != null && sent < expectedLength) {
                  continue;
                }
                let ok = await verifier.finish();
                if (!ok) {
                  throw new Error("Origin body failed length/digest verification");
                }
                controller.close();
                resolveDone();
                return;
              }
            }

            let result: ReadableStreamReadResult<Uint8Array>;
            try {
              result = await reader.read();
            } catch (error) {
              // Mid-body failure (for example the origin process died).
              // Keep the client stream open and resume from a new attempt.
              reader = null;
              lastError = error;
              continue;
            }

            if (result.done) {
              reader = null;
              if (expectedLength != null && sent < expectedLength) {
                // Clean but premature EOF: resume from a new attempt.
                continue;
              }
              if (expectedLength != null && sent > expectedLength) {
                throw new Error("Origin body exceeded Content-Length");
              }

              let ok = await verifier.finish();
              if (!ok) {
                throw new Error("Origin body failed length/digest verification");
              }

              controller.close();
              resolveDone();
              return;
            }

            let chunk = result.value;
            if (skip > 0) {
              if (chunk.byteLength <= skip) {
                skip -= chunk.byteLength;
                continue;
              }
              chunk = chunk.subarray(skip);
              skip = 0;
            }

            sent += chunk.byteLength;
            await verifier.update(chunk);
            controller.enqueue(chunk);
            return;
          }
        } catch (error) {
          rejectDone(error);
          controller.error(error);
        }
      },
      async cancel() {
        cancelled = true;
        rejectDone(new Error("Stream cancelled by consumer"));
        await reader?.cancel().catch(() => {});
      },
    },
    { highWaterMark: 1 }
  );

  return { stream, done };
}

// Fetches a URL with bounded retries. Transient origin failures (network
// errors, 5xx, truncated bodies) are retried; each attempt is independent
// and discards everything from the previous one. Bodies at or below the
// buffer threshold are fully verified before being returned. Larger bodies
// are returned as a resumable stream (see createResumableStream).
export async function fetchVerifiedResponse(
  makeRequest: () => Promise<Request> | Request,
  options: OriginFetchOptions = {}
): Promise<VerifiedResponse> {
  let resolved = resolveOptions(options);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt++) {
    if (attempt > 1) {
      await resolved.sleepFn(resolved.retryDelayMs * (attempt - 1));
    }

    let response: Response;
    try {
      response = await resolved.fetchFn(await makeRequest(), {
        signal: AbortSignal.timeout(resolved.fetchTimeoutMs),
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    if (response.status >= 500) {
      lastError = new Error(`Origin responded ${response.status}`);
      await response.body?.cancel().catch(() => {});
      continue;
    }

    if (!response.ok) {
      // 4xx and other non-OK statuses are the caller's to handle, and are
      // returned without retrying.
      return { response, done: Promise.resolve(), bodyVerified: false, streamed: false };
    }

    let length = getContentLength(response.headers);

    if (length != null && length <= resolved.bufferThresholdBytes) {
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (error) {
        lastError = error;
        continue;
      }

      let body = new Uint8Array(buffer);
      if (body.byteLength !== length) {
        lastError = new Error(
          `Origin body truncated: received ${body.byteLength} of ${length} bytes`
        );
        continue;
      }

      let digest = parseContentDigest(response.headers);
      if (digest != null && digest.algorithm === "sha256") {
        let actual = await sha256Base64(body);
        if (actual !== digest.hash) {
          if (attempt < resolved.maxAttempts) {
            lastError = new Error("Origin body failed digest verification");
            continue;
          }

          // Persistently mismatched digest with a correct length. The body
          // may be intentionally transformed content with a stale digest,
          // so serve it, but never cache it.
          return {
            response: new Response(body, response),
            done: Promise.resolve(),
            bodyVerified: false,
            streamed: false,
          };
        }
      }

      return {
        response: new Response(body, response),
        done: Promise.resolve(),
        bodyVerified: true,
        streamed: false,
      };
    }

    let { stream, done } = createResumableStream(response, makeRequest, resolved, attempt);
    return {
      response: new Response(stream, response),
      done,
      bodyVerified: true,
      streamed: true,
    };
  }

  throw new OriginFetchError("Origin fetch failed after all attempts", resolved.maxAttempts, lastError);
}
