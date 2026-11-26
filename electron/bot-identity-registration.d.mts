type Scope = { workspaceId: string; localBotId: string; bindingId: string; owner: string; room: string; origin: string };
type State = { kind: "new" } | { kind: "existing"; username: string };
type Identity = { username: string; publicKey: string };
type Claim = { origin: string; owner: string; bot: string; room: string; nonce: string };
type Store = { identity(botId: string, state: State): Promise<Identity>; signClaim(botId: string, state: State, claim: Claim): Promise<Identity & { signature: string }> };
type Input = Scope & { name: string };
export function createBotIdentityRegistration(deps: {
  identityStoreFor(scope: Scope): Promise<Store>;
  loadIdentity(scope: Scope): Promise<State>;
  commitIdentity(scope: Scope, expected: State, identity: Identity): Promise<State>;
  currentAccount(): Promise<string>;
  validateTarget(scope: Scope): Promise<boolean>;
  challenge(input: { owner: string; bot: string; room: string }): Promise<{ nonce: string }>;
  invite(input: { action: "invite"; owner: string; bot: string; room: string; name: string; username: string; proof: { nonce: string; publicKey: string; signature: string } }): Promise<unknown>;
}): { register(input: Input): Promise<{ username: string }> };
