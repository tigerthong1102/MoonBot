# Hosted workspace authentication in the OSS edition

This checkout does not include the Enterprise hosted workspace adapter. A
configured hosted workspace must fail closed when that adapter is absent;
local owner access remains available. The OSS server does not provide hosted
sign-in or the identity service's handoff endpoints.

Use an isolated server fixture and run:

```sh
pnpm exec vitest run server/hosted-oss.test.ts
```

The fixture checks readiness, hosted sign-in, remote sessions and local owner
access with an absent Enterprise layer. It does not establish that any hosted
identity service or Enterprise deployment works.
