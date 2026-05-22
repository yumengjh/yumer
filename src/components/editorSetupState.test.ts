import { describe, expect, it } from "vitest";
import { shouldShowSetupModal } from "./editorSetupState";

describe("shouldShowSetupModal", () => {
  it("does not show setup while auth state is still loading", () => {
    expect(
      shouldShowSetupModal({
        authLoading: true,
        isAuthenticated: false,
        workspaceId: null,
      }),
    ).toBe(false);
  });

  it("shows setup after auth loading when login or workspace is missing", () => {
    expect(
      shouldShowSetupModal({
        authLoading: false,
        isAuthenticated: false,
        workspaceId: null,
      }),
    ).toBe(true);
    expect(
      shouldShowSetupModal({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: null,
      }),
    ).toBe(true);
  });

  it("hides setup for an authenticated user with a workspace", () => {
    expect(
      shouldShowSetupModal({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: "ws-1",
      }),
    ).toBe(false);
  });
});
