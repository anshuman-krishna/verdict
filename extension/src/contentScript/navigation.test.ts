import { describe, expect, it, vi } from "vitest";
import { listingIdentity, watchUrl } from "./navigation";

describe("listingIdentity", () => {
  it("is the listing, not the url, so a tracking parameter changes nothing", () => {
    const plain = listingIdentity("https://www.amazon.com/dp/B0ABCDEFGH");
    const tracked = listingIdentity("https://www.amazon.com/dp/B0ABCDEFGH?ref=sr_1_3&th=1");
    expect(plain).not.toBeNull();
    expect(tracked).toBe(plain);
  });

  it("separates two listings on the same site", () => {
    expect(listingIdentity("https://www.amazon.com/dp/B0ABCDEFGH")).not.toBe(
      listingIdentity("https://www.amazon.com/dp/B0HGFEDCBA"),
    );
  });

  it("separates the same product id across locales", () => {
    expect(listingIdentity("https://www.amazon.com/dp/B0ABCDEFGH")).not.toBe(
      listingIdentity("https://www.amazon.de/dp/B0ABCDEFGH"),
    );
  });

  it("is null for anything that is not a product page", () => {
    expect(listingIdentity("https://www.amazon.com/s?k=headphones")).toBeNull();
    expect(listingIdentity("https://example.com/dp/B0ABCDEFGH")).toBeNull();
    expect(listingIdentity("not a url")).toBeNull();
  });
});

function harness(initial: string) {
  let href = initial;
  const listeners = new Map<string, () => void>();
  let poll: (() => void) | null = null;
  const onChange = vi.fn();
  const stop = watchUrl({
    getHref: () => href,
    onChange,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    setPoll: (run) => {
      poll = run;
      return "handle";
    },
    clearPoll: () => {
      poll = null;
    },
  });
  return {
    onChange,
    stop,
    go: (next: string) => {
      href = next;
    },
    tick: () => poll?.(),
    fire: (type: string) => listeners.get(type)?.(),
    listenerCount: () => listeners.size,
    polling: () => poll !== null,
  };
}

describe("watchUrl", () => {
  it("says nothing while the url holds still", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.tick();
    watcher.tick();
    expect(watcher.onChange).not.toHaveBeenCalled();
  });

  it("reports a url the page changed without an event", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.go("https://www.amazon.com/dp/B0HGFEDCBA");
    watcher.tick();
    expect(watcher.onChange).toHaveBeenCalledWith("https://www.amazon.com/dp/B0HGFEDCBA");
  });

  it("reports each url once, however many times it is asked", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.go("https://www.amazon.com/dp/B0HGFEDCBA");
    watcher.tick();
    watcher.tick();
    watcher.fire("popstate");
    expect(watcher.onChange).toHaveBeenCalledTimes(1);
  });

  it("reacts to a back button without waiting for the poll", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.go("https://www.amazon.com/dp/B0HGFEDCBA");
    watcher.fire("popstate");
    expect(watcher.onChange).toHaveBeenCalledTimes(1);
  });

  it("reacts to a hash change", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.go("https://www.amazon.com/dp/B0ABCDEFGH#reviews");
    watcher.fire("hashchange");
    expect(watcher.onChange).toHaveBeenCalledTimes(1);
  });

  it("lets go of the page when it is stopped", () => {
    const watcher = harness("https://www.amazon.com/dp/B0ABCDEFGH");
    watcher.stop();
    expect(watcher.listenerCount()).toBe(0);
    expect(watcher.polling()).toBe(false);
  });
});
