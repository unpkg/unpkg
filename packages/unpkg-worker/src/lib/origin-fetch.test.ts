import { describe, expect, it } from "bun:test";

import { sha256Base64 } from "./cache-utils.ts";
import { fetchVerifiedResponse, OriginFetchError, type OriginFetchOptions } from "./origin-fetch.ts";

const encoder = new TextEncoder();

async function digestHeader(body: Uint8Array): Promise<string> {
  return `sha256=:${await sha256Base64(body)}:`;
}

async function fileHeaders(body: Uint8Array, extra: Record<string, string> = {}): Promise<Headers> {
  return new Headers({
    "Content-Length": String(body.byteLength),
    "Content-Digest": await digestHeader(body),
    "Content-Type": "text/javascript",
    ...extra,
  });
}

function streamOf(chunks: Uint8Array[], errorAtEnd?: Error): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else if (errorAtEnd) {
        controller.error(errorAtEnd);
      } else {
        controller.close();
      }
    },
  });
}

function options(fetchFn: typeof fetch, overrides: OriginFetchOptions = {}): OriginFetchOptions {
  return {
    fetchFn,
    maxAttempts: 3,
    retryDelayMs: 0,
    sleepFn: async () => {},
    bufferThresholdBytes: 1024,
    ...overrides,
  };
}

const makeRequest = () => new Request("https://origin.test/file/pkg@1.0.0/index.js");

describe("fetchVerifiedResponse (buffered)", () => {
  it("returns a verified body", async () => {
    let body = encoder.encode("hello world");
    let fetchFn = (async () =>
      new Response(body, { headers: await fileHeaders(body) })) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(verified.bodyVerified).toBe(true);
    expect(await verified.response.text()).toBe("hello world");
    await verified.done;
  });

  it("retries when the connection drops before responding", async () => {
    let body = encoder.encode("hello world");
    let headers = await fileHeaders(body);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("Network connection lost.");
      return new Response(body, { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(calls).toBe(2);
    expect(await verified.response.text()).toBe("hello world");
  });

  it("retries on a 502 from the origin", async () => {
    let body = encoder.encode("hello world");
    let headers = await fileHeaders(body);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) return new Response("Bad Gateway", { status: 502 });
      return new Response(body, { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(calls).toBe(2);
    expect(await verified.response.text()).toBe("hello world");
  });

  it("returns a 404 immediately without retrying", async () => {
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(calls).toBe(1);
    expect(verified.response.status).toBe(404);
    expect(verified.bodyVerified).toBe(false);
  });

  it("retries a truncated body and returns the complete one", async () => {
    let full = encoder.encode("0123456789");
    let truncated = full.subarray(0, 5);
    let headers = await fileHeaders(full);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      // Truncated body carrying the full body's headers: the classic
      // mid-transfer origin death.
      return new Response(calls === 1 ? truncated : full, { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(calls).toBe(2);
    expect(verified.bodyVerified).toBe(true);
    expect(await verified.response.text()).toBe("0123456789");
  });

  it("fails after the attempt cap when every body is truncated", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let fetchFn = (async () =>
      new Response(full.subarray(0, 5), { headers })) as typeof fetch;

    await expect(fetchVerifiedResponse(makeRequest, options(fetchFn))).rejects.toBeInstanceOf(
      OriginFetchError
    );
  });

  it("retries a digest mismatch, then serves the body uncached if it persists", async () => {
    let body = encoder.encode("hello world");
    let wrongHeaders = new Headers({
      "Content-Length": String(body.byteLength),
      // Digest of the empty string: valid format, wrong value.
      "Content-Digest": "sha256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:",
    });
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(body, { headers: wrongHeaders });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(calls).toBe(3);
    expect(verified.bodyVerified).toBe(false);
    expect(await verified.response.text()).toBe("hello world");
  });

  it("serves self-consistent content with no external expectation of its bytes", async () => {
    let body = encoder.encode("bytes nobody predicted, served intentionally");
    let fetchFn = (async () =>
      new Response(body, { headers: await fileHeaders(body) })) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(verified.bodyVerified).toBe(true);
    expect(new Uint8Array(await verified.response.arrayBuffer())).toEqual(body);
  });

  it("verifies by length when Content-Digest is absent", async () => {
    let body = encoder.encode("hello world");
    let fetchFn = (async () =>
      new Response(body, {
        headers: { "Content-Length": String(body.byteLength) },
      })) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, options(fetchFn));

    expect(verified.bodyVerified).toBe(true);
    expect(await verified.response.text()).toBe("hello world");
  });
});

describe("fetchVerifiedResponse (default fetch)", () => {
  it("calls the global fetch with a correct this binding", async () => {
    // The Workers runtime throws "Illegal invocation" when the global
    // fetch is extracted and called unbound. Bun tolerates it, so assert
    // the binding explicitly with a this-sensitive stand-in.
    let body = encoder.encode("hello world");
    let headers = await fileHeaders(body);
    let originalFetch = globalThis.fetch;

    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect `this` reference");
      }
      return Promise.resolve(new Response(body, { headers }));
    } as typeof fetch;

    try {
      let verified = await fetchVerifiedResponse(makeRequest, {
        maxAttempts: 1,
        retryDelayMs: 0,
        sleepFn: async () => {},
      });
      expect(await verified.response.text()).toBe("hello world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchVerifiedResponse (streamed)", () => {
  const streamed = (fetchFn: typeof fetch, overrides: OriginFetchOptions = {}) =>
    options(fetchFn, { bufferThresholdBytes: 4, ...overrides });

  it("streams a complete large body", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let fetchFn = (async () =>
      new Response(streamOf([full.subarray(0, 4), full.subarray(4)]), {
        headers,
      })) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    expect(await verified.response.text()).toBe("0123456789");
    await verified.done;
  });

  it("resumes after a mid-body stream error by skipping the sent prefix", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          streamOf([full.subarray(0, 5)], new TypeError("Network connection lost.")),
          { headers }
        );
      }
      return new Response(streamOf([full]), { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    expect(await verified.response.text()).toBe("0123456789");
    await verified.done;
    expect(calls).toBe(2);
  });

  it("resumes after a clean but premature EOF", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      let body = calls === 1 ? streamOf([full.subarray(0, 5)]) : streamOf([full]);
      return new Response(body, { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    expect(await verified.response.text()).toBe("0123456789");
    await verified.done;
    expect(calls).toBe(2);
  });

  it("resumes twice when the second attempt also dies, keeping prior progress", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          streamOf([full.subarray(0, 5)], new TypeError("Network connection lost.")),
          { headers }
        );
      }
      if (calls === 2) {
        return new Response(
          streamOf([full.subarray(0, 8)], new TypeError("Network connection lost.")),
          { headers }
        );
      }
      return new Response(streamOf([full]), { headers });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    expect(await verified.response.text()).toBe("0123456789");
    await verified.done;
    expect(calls).toBe(3);
  });

  it("errors the stream when the content changes between attempts", async () => {
    let full = encoder.encode("0123456789");
    let other = encoder.encode("ABCDEFGHIJ");
    let headers = await fileHeaders(full);
    let otherHeaders = await fileHeaders(other);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          streamOf([full.subarray(0, 5)], new TypeError("Network connection lost.")),
          { headers }
        );
      }
      return new Response(streamOf([other]), { headers: otherHeaders });
    }) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    await expect(verified.response.text()).rejects.toThrow();
    await expect(verified.done).rejects.toThrow();
  });

  it("errors the stream when every attempt dies mid-body", async () => {
    let full = encoder.encode("0123456789");
    let headers = await fileHeaders(full);
    let fetchFn = (async () =>
      new Response(streamOf([full.subarray(0, 5)], new TypeError("Network connection lost.")), {
        headers,
      })) as typeof fetch;

    let verified = await fetchVerifiedResponse(makeRequest, streamed(fetchFn));

    await expect(verified.response.text()).rejects.toThrow();
    await expect(verified.done).rejects.toThrow();
  });
});
