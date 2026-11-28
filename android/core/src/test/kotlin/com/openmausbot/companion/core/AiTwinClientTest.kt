package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

class AiTwinClientTest {
    @Test
    fun twinUsesAKnownProtectedRouteAndLeavesEnoughTimeForDrafting() = runBlocking {
        val hosted = requireNotNull(CompanionEndpoint.create("https://paired.example", CompanionEndpointKind.HOSTED, 50))
        val lan = requireNotNull(CompanionEndpoint.direct("192.168.1.4", 8810, priority = 0))
        val requests = mutableListOf<Pair<String, Int>>()
        val http = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("https", request.url.scheme)
            assertEquals("paired.example", request.url.host)
            assertEquals("Bearer paired-token", request.header("Authorization"))
            requests += request.url.encodedPath to chain.readTimeoutMillis()
            val body = request.body
            val response = if (body == null) {
                """{"twin":{"id":"twin-1","name":"Owner","revision":2,"paused":false},"preview":{"key":"provider","name":"Fixture","model":"test"}}"""
            } else {
                val buffer = Buffer()
                body.writeTo(buffer)
                val json = CompanionJson.parseToJsonElement(buffer.readUtf8()).jsonObject
                assertEquals(JsonPrimitive(2), json["revision"])
                assertEquals(JsonPrimitive("provider"), json["key"])
                assertEquals(JsonPrimitive(true), json["useProvider"])
                assertEquals(JsonPrimitive(true).takeIf { request.url.encodedPath.endsWith("/preview") }, json["useMemory"])
                """{"draft":"A private response"}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(response.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val connection = Connection(name = "Desktop", host = lan.host, port = lan.port, activeEndpoint = lan, endpoints = listOf(lan, hosted))
        val client = CompanionClient(connection, "paired-token", http)
        val status = client.aiTwin()
        val profile = requireNotNull(status.twin)
        val provider = requireNotNull(status.preview)
        client.askAiTwin(profile, "Can I learn?", AiTwinAction.Semantic, provider)
        client.askAiTwin(profile, "Can I learn?", AiTwinAction.Draft, provider)
        assertEquals(listOf("/api/ai-twin" to 20_000, "/api/ai-twin/lookup" to 45_000, "/api/ai-twin/preview" to 65_000), requests)
    }

    @Test
    fun plaintextLanDoesNotReceiveStatusOrQuestion() = runBlocking {
        var requests = 0
        val http = OkHttpClient.Builder().addInterceptor {
            requests += 1
            error("AI Twin tried to send a plaintext request")
        }.build()
        val connection = Connection(name = "LAN", host = "192.168.1.4", port = 8810)
        val client = CompanionClient(connection, "paired-token", http)
        assertFailsWith<APIError.Transport> { client.aiTwin() }
        assertFailsWith<APIError.Transport> { client.askAiTwin(AiTwinProfile("id", "Name", 1, false), "Private", AiTwinAction.Exact, null) }
        assertEquals(0, requests)
    }
}
