# Bitwarden login grants

On the computer running StartupBot, sign in with the official Bitwarden CLI
and set `STARTUPBOT_BITWARDEN_CLI` to its absolute executable path before
starting StartupBot. From Settings → Vault → Bitwarden, enter the item UUID,
the exact HTTPS sign-in hostname, the output of `bw unlock --raw`, and one bot.
A grant lasts up to one hour in this server process. Revoke it in the same
panel. Restarting the server clears all Bitwarden sessions and grants.
StartupBot syncs and verifies the specific item at grant and fill time.
Only the form filler receives the password. Local server logs record the
administrator and item ID when a grant is added or revoked.
