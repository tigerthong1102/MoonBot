export declare function internalDeepLink(value: string): string;
export declare function internalDeepLink(value: unknown): unknown;
export declare function queueIncomingChatLink(value: unknown, handlers: {
  parse(value: unknown): string | null;
  store(link: string): void;
  reveal(): void;
  deliver(): void;
}): boolean;
