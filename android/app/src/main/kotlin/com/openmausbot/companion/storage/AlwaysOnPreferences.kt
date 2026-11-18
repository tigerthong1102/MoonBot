// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AlwaysOnPreferences(private val prefs: SharedPreferences) {

    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE),
    )

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, false))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    fun setEnabled(value: Boolean): Boolean {
        if (_enabled.value == value) return true
        val saved = prefs.edit().putBoolean(KEY_ENABLED, value).commit()
        if (saved) _enabled.value = value
        return saved
    }

    companion object {
        const val NAME = "openmaus.always_on"
        const val KEY_ENABLED = "enabled"
    }
}
