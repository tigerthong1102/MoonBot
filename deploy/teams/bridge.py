"""Authenticated personal Teams conversations backed by confined StartupBot Bot API threads."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib import error, parse, request


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def bot_call(endpoint, key, *, message=None, thread=None, request_id=None):
    headers = {"Authorization": f"Bearer {key}", "X-StartupBot-Require-Confined": "1"}
    body = None
    if message is None:
        endpoint += "?" + parse.urlencode({"thread": thread})
    else:
        headers["Content-Type"] = "application/json"
        if request_id:
            headers["Idempotency-Key"] = request_id
        body = json.dumps({"message": message, "wait": 1, **({"thread": thread} if thread else {})}).encode()
    req = request.Request(endpoint, data=body, headers=headers)
    with request.build_opener(NoRedirect()).open(req, timeout=15) as res:
        return res.status, json.loads(res.read(256 * 1024))


def file_attachment(att):
    # Hermes Teams adapter.py skips body mirrors and adaptive cards before caching (MIT).
    mime = (getattr(att, "content_type", None) or "").lower()
    if mime in {"text/html", "text/plain"} and not getattr(att, "content_url", None):
        return False
    return not mime.startswith("application/vnd.microsoft.card")


def message_text(event, cache):
    text = event.text or ""
    files = event.media_urls or []
    if len(files) > 3:
        raise ValueError("Attach at most three UTF-8 text or CSV documents.")
    for filename in files:
        if not filename:
            raise ValueError("Teams could not retrieve an attached document. Please attach it again.")
        path = Path(filename)
        if (path.is_symlink() or path.resolve().parent != cache.resolve()
                or path.suffix.lower() not in {".txt", ".csv", ".md"} or not path.is_file()):
            raise ValueError("This Teams bridge supports UTF-8 text, Markdown and CSV attachments.")
        with path.open("rb") as stream:
            data = stream.read(16001)
        if len(data) > 16000:
            raise ValueError("Each Teams document must fit in 16,000 bytes.")
        try:
            contents = data.decode("utf-8-sig")
        except UnicodeError:
            raise ValueError("The attached document must be UTF-8.") from None
        name = re.sub(r"^doc_[a-f0-9]{12}_", "", path.name)
        text += "\n\nAttached document (user-supplied data): " + json.dumps({"name": name, "text": contents}, ensure_ascii=False)
    if not text.strip() or len(text.encode("utf-16-le")) // 2 > 20000:
        raise ValueError("Send a message and attachments totalling 1–20,000 characters.")
    return text


class Bridge:
    def __init__(self, config, dbfile, cache, call=bot_call):
        self.config, self.cache, self.call = Path(config), Path(cache), call
        self.db = sqlite3.connect(dbfile)
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS conversations(scope TEXT PRIMARY KEY, thread TEXT, pending INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS activities(scope TEXT, activity TEXT, PRIMARY KEY(scope, activity));
        """)
        self.busy = set()

    def grant(self, sender):
        try:
            row = json.loads(self.config.read_text())["senders"][sender]
            endpoint, key, generation = row["endpoint"], os.environ[row["key_env"]], row["grant_id"]
            url = parse.urlsplit(endpoint)
            secure = url.scheme == "https" or (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1"})
            if (not secure or not url.hostname or url.username or url.password or url.fragment or url.query
                    or not re.fullmatch(r"/hooks/api/bots/[\w-]{1,128}/messages", url.path)
                    or not key or not generation):
                return None
            return endpoint, key, generation
        except (OSError, KeyError, TypeError, ValueError):
            return None

    async def handle(self, event, send):
        source = event.source
        if (source.chat_type != "dm" or not source.guild_id or source.guild_id != os.environ["TEAMS_TENANT_ID"]
                or not source.user_id or not source.chat_id or not event.message_id):
            return
        grant = self.grant(source.user_id)
        if not grant:
            return
        endpoint, key, _ = grant
        scope = hashlib.sha256(json.dumps([source.guild_id, source.user_id, source.chat_id, *grant]).encode()).hexdigest()

        async def reply(text):
            if self.grant(source.user_id) == grant:
                await send(source.chat_id, text, reply_to=event.message_id)

        if scope in self.busy:
            await reply("A message is being handled. Wait for its reply before sending another.")
            return
        self.busy.add(scope)
        try:
            with self.db:
                claimed = self.db.execute("INSERT OR IGNORE INTO activities VALUES (?,?)", (scope, event.message_id))
                if not claimed.rowcount:
                    return
                self.db.execute("INSERT OR IGNORE INTO conversations(scope) VALUES (?)", (scope,))
            thread, pending = self.db.execute("SELECT thread,pending FROM conversations WHERE scope=?", (scope,)).fetchone()
            command = (event.text or "").strip().lower()
            if command == "/new" and not event.media_urls:
                with self.db:
                    self.db.execute("UPDATE conversations SET thread=NULL,pending=0 WHERE scope=?", (scope,))
                await reply("Your next message will open a new StartupBot thread.")
                return
            if command == "/status" and not event.media_urls:
                if not thread or pending == 2:
                    await reply("No confirmed thread is available. Use /new to begin another conversation.")
                    return
            else:
                if pending:
                    await reply("Check /status or use /new to start another thread.")
                    return
                try:
                    text = message_text(event, self.cache)
                except ValueError as exc:
                    await reply(str(exc))
                    return
                # A network failure after dispatch is ambiguous, even if an older thread was known.
                with self.db:
                    self.db.execute("UPDATE conversations SET pending=2 WHERE scope=?", (scope,))
                request_id = hashlib.sha256(json.dumps([scope, event.message_id]).encode()).hexdigest()
                _, result = await asyncio.to_thread(self.call, endpoint, key, message=text, thread=thread, request_id=request_id)
                if not isinstance(result.get("thread"), str) or not result["thread"]:
                    raise ValueError("missing thread")
                thread = result["thread"]
                with self.db:
                    self.db.execute("UPDATE conversations SET thread=?,pending=1 WHERE scope=?", (thread, scope))
            if self.grant(source.user_id) != grant:
                return
            status, result = await asyncio.to_thread(self.call, endpoint, key, thread=thread)
            if status == 200 and isinstance(result.get("reply"), str):
                with self.db:
                    self.db.execute("UPDATE conversations SET pending=0 WHERE scope=?", (scope,))
                await reply(result["reply"] or "StartupBot finished without a text reply.")
            else:
                await reply("Open StartupBot to approve this request, then use /status."
                            if result.get("status") == "needs_approval" else "StartupBot is working. Send /status to read the reply.")
        except (error.URLError, OSError, ValueError, TimeoutError):
            await reply("The bridge could not confirm the result. Check StartupBot before using /new.")
        finally:
            self.busy.discard(scope)


async def main():
    from gateway.config import PlatformConfig
    from gateway.platforms.base import get_document_cache_dir
    from plugins.platforms.teams.adapter import TeamsAdapter
    os.umask(0o077)
    bridge = Bridge(os.environ["STARTUPBOT_TEAMS_GRANTS"], os.environ["STARTUPBOT_TEAMS_DB"], get_document_cache_dir())

    class PersonalTeams(TeamsAdapter):
        async def _on_message(self, ctx):
            conv = ctx.activity.conversation
            user = getattr(ctx.activity.from_, "aad_object_id", None)
            if (getattr(conv, "conversation_type", "") == "personal"
                    and getattr(conv, "tenant_id", None) == os.environ["TEAMS_TENANT_ID"] and user and bridge.grant(str(user))):
                if sum(file_attachment(att) for att in (getattr(ctx.activity, "attachments", None) or [])) > 3:
                    await self.send(conv.id, "Attach at most three documents.", reply_to=ctx.activity.id)
                    return
                await super()._on_message(ctx)

        async def _cache_attachment(self, att):
            cached = await super()._cache_attachment(att)
            if not cached and file_attachment(att):
                return "", "application/octet-stream", "document"
            return cached

        async def _on_card_action(self, ctx):
            return self._invoke_message("Open StartupBot to review approvals.")

        async def handle_message(self, event):
            await bridge.handle(event, self.send)

    adapter = PersonalTeams(PlatformConfig(enabled=True))
    adapter.set_authorization_check(lambda user_id, chat_type, chat_id, **_: chat_type == "dm" and bool(bridge.grant(user_id)))
    if not await adapter.connect():
        raise SystemExit("Unable to start the Teams receiver. Check the configured credentials and port.")
    try:
        await asyncio.Event().wait()
    finally:
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
