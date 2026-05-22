export interface EditorSetupStateInput {
  authLoading: boolean;
  isAuthenticated: boolean;
  workspaceId: string | null | undefined;
}

export function shouldShowSetupModal({
  authLoading,
  isAuthenticated,
  workspaceId,
}: EditorSetupStateInput): boolean {
  if (authLoading) return false;
  return !isAuthenticated || !workspaceId;
}
