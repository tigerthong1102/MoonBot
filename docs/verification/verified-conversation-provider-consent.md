# Verified conversation provider consent

Status: disabled. The verified conversation answer route returns 409 in the
application because it has no provider identity capability. The existing
knowledge-answer route has separate behavior and is not changed by this design.

## OpenAI-compatible feasibility

An OpenAI-compatible runtime captures its API URL and selected key when the
driver instance is created. That is insufficient for informed consent: a
gateway such as OpenRouter may choose a downstream provider; an endpoint can
redirect a text request; and the resolved model may be obtained asynchronously.
The queued source-answer writer is refreshed after the current start callback.
The current provider object identity does not bind a consent given before POST
to the actual writer and transport. The process cannot verify what a remote
gateway does after receiving a request.

## Proposed narrow contract

Support only a driver that supplies an immutable, server-owned transport
snapshot. Issue a short-lived, one-use opaque capability to the desktop owner
alongside the destination that will be shown before consent. Bind it to the
owner, conversation, question and selected message IDs and digests, model,
driver configuration generation, endpoint and account/credential generation.
Never return, log or persist the credential or a reversible fingerprint of it.
Bind upstream routing policy where known; when the gateway's downstream route
is unknown, disclose it as unknown and do not claim it is a specific provider.

At admission verify and consume the capability. After the queue refreshes its
writer, use the exact immutable driver snapshot, and revalidate source access,
budget, model and provider generation immediately at the transport boundary.
The transport must refuse redirects on every attempt, including retries, and
must not substitute a different model, account or endpoint. Revalidate before
returning an answer. An expired, reused, missing or mismatched capability must
fail closed. The client must not receive a capability from a previous consent
screen after its source selection or provider changes.

These checks cannot recall a request already transmitted, establish the
gateway's downstream behavior, or make source revocation atomic with network
delivery. They do not provide document ACLs or enterprise memory guarantees.
No UI should claim these properties.

## Required verification before enabling

- On an isolated HTTP fixture, change URL, key/account, routing policy or model
  after consent but before POST, while queued, and during generation. No wrong
  destination receives source content; an in-flight change suppresses output.
- Exercise the real writer refresh and transport, not only a handler mock.
  Test every retry and asynchronous model resolution path.
- A 301, 302, 303, 307 or 308 from the configured endpoint must not forward
  the request to the redirect destination. Verify the destination receives no
  body or credentials.
- Reject expired, replayed, cross-owner, cross-conversation and altered-source
  capabilities. Check cancellation, concurrency and quotas, and verify no
  credential or secret-bearing URL appears in responses, logs or fixtures.
- Confirm provider policy and usage accounting are checked at actual dispatch;
  retain regression coverage for the existing knowledge-answer route.

The current tests only establish the disabled production gate, plus mocked
identity changes during queueing and generation. They do not establish this
proposed contract or authorize enabling it.
