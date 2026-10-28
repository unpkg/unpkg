import { describe, expect, it } from "bun:test";

import { ConcurrencyLimiter, OverloadedError } from "./concurrency.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ConcurrencyLimiter", () => {
  it("never runs more than the limit concurrently", async () => {
    let limiter = new ConcurrencyLimiter(3, 1000);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(10);
          active--;
        })
      )
    );
    expect(peak).toBe(3);
    expect(limiter.stats().acquired).toBe(12);
    expect(limiter.stats().shed).toBe(0);
  });

  it("admits queued work in FIFO order as slots free", async () => {
    let limiter = new ConcurrencyLimiter(1, 1000);
    let order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        limiter.run(async () => {
          order.push(n);
          await sleep(5);
        })
      )
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("sheds queued work with OverloadedError after the queue timeout", async () => {
    let limiter = new ConcurrencyLimiter(1, 20);
    let first = limiter.run(() => sleep(60));
    let second = limiter.run(() => sleep(1));
    await expect(second).rejects.toBeInstanceOf(OverloadedError);
    await first;
    expect(limiter.stats().shed).toBe(1);
    expect(limiter.stats().active).toBe(0);
  });
});
