import { beforeEach, describe, expect, test, vi } from "vitest";

const endpointRouterMock = vi.fn();

vi.mock("../endpoints/endpoint_router.js", () => ({
    endpoint_router: endpointRouterMock,
}));

describe("fetchCurrentUserProfile", () => {
    beforeEach(() => {
        vi.resetModules();
        endpointRouterMock.mockReset();
        vi.useRealTimers();
        localStorage.clear();
    });

    test("dedupes concurrent profile fetches", async () => {
        endpointRouterMock.mockResolvedValue({ user_id: 7, username: "Ada" });

        const {
            fetchCurrentUserProfile,
            resetCurrentUserProfileCache,
        } = await import("./current_user_profile_fetcher.js");
        resetCurrentUserProfileCache();

        const [first, second] = await Promise.all([
            fetchCurrentUserProfile(),
            fetchCurrentUserProfile(),
        ]);

        expect(first).toEqual(second);
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith("fetchUserProfile");
    });

    test("reuses a short-lived cached profile result", async () => {
        vi.useFakeTimers();
        endpointRouterMock.mockResolvedValue({ user_id: 7, username: "Ada" });

        const {
            fetchCurrentUserProfile,
            resetCurrentUserProfileCache,
        } = await import("./current_user_profile_fetcher.js");
        resetCurrentUserProfileCache();

        const first = await fetchCurrentUserProfile();
        vi.advanceTimersByTime(1000);
        const second = await fetchCurrentUserProfile();

        expect(first).toEqual(second);
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });

    test("force refresh bypasses the short-lived cache", async () => {
        endpointRouterMock
            .mockResolvedValueOnce({ user_id: 7, username: "Ada" })
            .mockResolvedValueOnce({ user_id: 7, username: "Grace" });

        const {
            fetchCurrentUserProfile,
            resetCurrentUserProfileCache,
        } = await import("./current_user_profile_fetcher.js");
        resetCurrentUserProfileCache();

        await fetchCurrentUserProfile();
        const refreshed = await fetchCurrentUserProfile({ forceRefresh: true });

        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
        expect(refreshed).toEqual({ user_id: 7, username: "Grace" });
    });

    test("skips profile fetch when auth shell is known anonymous", async () => {
        localStorage.setItem("button_state", "login");

        const {
            fetchCurrentUserProfile,
            resetCurrentUserProfileCache,
        } = await import("./current_user_profile_fetcher.js");
        resetCurrentUserProfileCache();

        await expect(fetchCurrentUserProfile()).resolves.toBeNull();
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });
});
