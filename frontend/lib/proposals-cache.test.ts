import { createTtlCache } from "./proposals-cache";

describe("createTtlCache", () => {
  it("serves one read to every caller within the TTL", async () => {
    let time = 0;
    const load = jest.fn().mockResolvedValue("first");
    const cache = createTtlCache(load, 1000, () => time);

    expect(await cache.get()).toBe("first");
    time = 999;
    expect(await cache.get()).toBe("first");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL has passed", async () => {
    let time = 0;
    const load = jest.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const cache = createTtlCache(load, 1000, () => time);

    await cache.get();
    time = 1000;
    expect(await cache.get()).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read between concurrent callers", async () => {
    let resolve!: (value: string) => void;
    const load = jest.fn(() => new Promise<string>(r => (resolve = r)));
    const cache = createTtlCache(load, 1000);

    const callers = [cache.get(), cache.get(), cache.get()];
    resolve("shared");
    expect(await Promise.all(callers)).toEqual(["shared", "shared", "shared"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error("RPC down")).mockResolvedValueOnce("ok");
    const cache = createTtlCache(load, 1000);

    await expect(cache.get()).rejects.toThrow("RPC down");
    expect(await cache.get()).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets the value when cleared", async () => {
    const load = jest.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const cache = createTtlCache(load, 1000);

    await cache.get();
    cache.clear();
    expect(await cache.get()).toBe("second");
  });
});
