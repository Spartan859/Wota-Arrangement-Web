import { describe, expect, it, vi } from "vitest";
import { createAuthentikRequest } from "../server/services/authentik-request";

describe("Authentik request retry", () => {
  it("retries the startup 503 response and returns the ready response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("authentik starting", { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ready: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const sleepImpl = vi.fn(async () => undefined);
    const request = createAuthentikRequest("http://authentik:9000/", {
      attempts: 3,
      retryDelayMs: 17,
      fetchImpl,
      sleepImpl,
    });

    await expect(request("/root/config/", "token")).resolves.toEqual({
      ready: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(17);
  });

  it("does not retry other Authentik errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const sleepImpl = vi.fn(async () => undefined);
    const request = createAuthentikRequest("http://authentik:9000", {
      attempts: 3,
      fetchImpl,
      sleepImpl,
    });

    await expect(request("/root/config/", "token")).rejects.toThrow(
      "GET /root/config/ failed: 403 forbidden",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
