---
name: phone-connection
description: "Troubleshoot an authorized StartupBot phone connection over LAN, Tailscale, HTTPS or an owner-configured relay."
---

# Phone connection

StartupBot runs tasks on the host computer. That computer must be on, awake,
online and running StartupBot. A phone connection does not keep tasks running
when the host is off.

Check Settings → Phone & devices and the paired device's access scope. Use only
routes enabled by the owner:

- Same Wi-Fi/LAN: both devices must be able to reach each other.
- Tailscale: both devices need an authorized route on the owner's tailnet.
- HTTPS: use the owner's configured endpoint with a valid certificate.
- Relay: use an explicitly configured, authorized relay. StartupBot does not
  provide or authorize free access to an upstream relay or cloud service.

Check device authorization, expiry and revocation before diagnosing networking.
Do not bypass device restrictions, disable TLS verification or fall back from
an encrypted pairing to plaintext. Preserve E2E encryption and the protocol's
version checks. Re-pair through Settings when credentials have been revoked.

Do not tell users to download a StartupBot native mobile app until an actual
approved internal artifact or store listing is available. The phone web client
and native applications have separate build and verification status.
