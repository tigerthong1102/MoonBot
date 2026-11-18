// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

object RelativeStamp {

    fun list(
        atMillis: Double,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        if (atMillis <= 0) return ""
        val at = zoned(atMillis, zone)
        val now = zoned(nowMillis.toDouble(), zone)
        return when {
            at.toLocalDate() == now.toLocalDate() -> time(atMillis, zone, locale)
            at.toLocalDate() == now.toLocalDate().minusDays(1) -> "Yesterday"
            at.isAfter(now.minusDays(6)) -> weekdayFormatter(locale).format(at)
            else -> dateFormatter(locale).format(at)
        }
    }

    fun separator(
        atMillis: Double,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val at = zoned(atMillis, zone)
        val now = zoned(nowMillis.toDouble(), zone)
        val clock = time(atMillis, zone, locale)
        return when {
            at.toLocalDate() == now.toLocalDate() -> "Today $clock"
            at.toLocalDate() == now.toLocalDate().minusDays(1) -> "Yesterday $clock"
            else -> "${dateFormatter(locale).format(at)} $clock"
        }
    }

    fun updated(
        atMillis: Double,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        if (atMillis <= 0.0 || !atMillis.isFinite()) return ""
        return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT, FormatStyle.SHORT)
            .withLocale(locale)
            .format(zoned(atMillis, zone))
    }

    fun time(
        atMillis: Double,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
        .withLocale(locale)
        .format(zoned(atMillis, zone))

    fun dateAndTime(
        atMillis: Double,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .format(zoned(atMillis, zone))

    private fun zoned(millis: Double, zone: ZoneId): ZonedDateTime =
        ZonedDateTime.ofInstant(Instant.ofEpochMilli(millis.toLong()), zone)

    private fun weekdayFormatter(locale: Locale) = DateTimeFormatter.ofPattern("EEEE", locale)

    private fun dateFormatter(locale: Locale) = DateTimeFormatter.ofPattern("MMM d", locale)
}
