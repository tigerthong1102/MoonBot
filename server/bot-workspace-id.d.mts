export function createBotWorkspaceIdStore(options: {
  directory: string;
  hasAnchoredBots(): boolean | null;
  acquireOwnerGuard(): { held: true; release(): void };
}): { loadOrCreate(): string };
