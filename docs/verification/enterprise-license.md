# Optional Enterprise layer in the OSS edition

This checkout does not ship an Enterprise layer. The OSS server reports its
edition without enabling Enterprise features when a license key is present.
The Docker image smoke checks the same behavior and verifies the layer is absent.

```sh
pnpm exec vitest run server/enterprise.test.ts
```

These tests use temporary fixtures. They do not qualify an Enterprise license
or hosted deployment.
