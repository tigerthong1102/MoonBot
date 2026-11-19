export declare function internalDeepLink(value: string): string;
export declare function packagedSmokeHome(env: Record<string, string | undefined>): { HOME?: string; USERPROFILE?: string };
export declare function internalDeepLink(value: unknown): unknown;
export declare function queueIncomingChatLink(value: unknown, handlers: {
  parse(value: unknown): string | null;
  store(link: string): void;
  reveal(): void;
  deliver(): void;
}): boolean;
export declare function personalInboxOrigin(value?: string): string | null;
