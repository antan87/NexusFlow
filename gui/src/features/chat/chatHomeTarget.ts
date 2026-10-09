/**
 * Where the app opens. The chat is the centre of the app, so it opens on the chat the user was last in: the one in
 * front, or else another that is still open. Nothing to open when none of those workspaces exists any more.
 */
export function chatHomeTarget(activeTab: string | null, openTabs: readonly string[], workspaceIds: readonly string[]): string | null {
  const exists = new Set(workspaceIds);
  if (activeTab && exists.has(activeTab)) return activeTab;
  return openTabs.find((tab) => exists.has(tab)) ?? null;
}
