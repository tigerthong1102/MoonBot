import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as Obj
import unittest
from unittest.mock import AsyncMock, patch

from bridge import Bridge, message_text


class TestTeams(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / "grants"
        self.row = {"endpoint": "https://bot.invalid/hooks/api/bots/finance/messages",
                    "key_env": "TEST_BOT_KEY", "grant_id": "installation-1"}
        self.config.write_text(json.dumps({"senders": {"user": self.row}}))
        env = patch.dict(os.environ, {"TEAMS_TENANT_ID": "tenant", "TEST_BOT_KEY": "secret"})
        env.start()
        self.addCleanup(env.stop)
        self.calls, self.send = [], AsyncMock()
        self.bridge = self.open()

    def open(self):
        def call(endpoint, key, **kw):
            self.calls.append(kw)
            return 200, {"thread": "thread-1", "reply": "report"}
        bridge = Bridge(self.config, self.root / "db", self.root, call)
        self.addCleanup(bridge.db.close)
        return bridge

    def event(self, activity="1", text="hello", **source):
        return Obj(message_id=activity, text=text, media_urls=[], source=Obj(**{
            "user_id": "user", "chat_type": "dm", "chat_id": "chat", "guild_id": "tenant", **source}))

    async def test_attachment_and_bound_chat_after_restart(self):
        file = self.root / "doc_aaaaaaaaaaaa_data.csv"
        file.write_text("amount\n123")
        event = self.event()
        event.media_urls = [str(file)]
        await self.bridge.handle(event, self.send)
        self.assertIn('data.csv', self.calls[0]["message"])
        self.assertNotIn(str(self.root), self.calls[0]["message"])
        self.assertEqual(self.calls[1], {"thread": "thread-1"})
        again = self.open()
        await again.handle(event, self.send)
        await again.handle(self.event("2"), self.send)
        self.assertEqual(self.calls[2]["thread"], "thread-1")
        self.assertEqual(self.send.await_count, 2)

    async def test_only_bound_personal_tenant_and_revoked_after_dispatch(self):
        for key, value in [("guild_id", "foreign"), ("chat_type", "group"), ("user_id", "unknown")]:
            await self.bridge.handle(self.event(**{key: value}), self.send)
        self.assertFalse(self.calls)
        def revoke(*args, **kwargs):
            self.config.unlink()
            return 200, {"thread": "thread-1", "reply": "private"}
        self.bridge.call = revoke
        await self.bridge.handle(self.event(), self.send)
        self.send.assert_not_awaited()

    async def test_ambiguous_dispatch_is_never_replayed(self):
        def timeout(*args, **kw):
            self.calls.append(kw)
            raise TimeoutError()
        self.bridge.call = timeout
        await self.bridge.handle(self.event(), self.send)
        await self.open().handle(self.event(), self.send)
        await self.open().handle(self.event("2"), self.send)
        self.assertEqual(len(self.calls), 1)
        await self.open().handle(self.event("3", "/new"), self.send)
        await self.open().handle(self.event("4"), self.send)
        self.assertIsNone(self.calls[1]["thread"])

    def test_files_and_destinations_are_bounded(self):
        event = self.event()
        event.media_urls = [__file__]
        with self.assertRaises(ValueError):
            message_text(event, self.root)
        for endpoint in ["http://example.org/hooks/api/bots/x/messages", "https://user:a@host/hooks/api/bots/x/messages"]:
            self.row["endpoint"] = endpoint
            self.config.write_text(json.dumps({"senders": {"user": self.row}}))
            self.assertIsNone(self.bridge.grant("user"))
