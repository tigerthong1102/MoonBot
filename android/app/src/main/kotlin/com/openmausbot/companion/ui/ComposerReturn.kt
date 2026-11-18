// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

object ComposerReturn {
    fun sends(
        isReturnKey: Boolean,
        keyDown: Boolean,
        shift: Boolean,
        fromSoftwareKeyboard: Boolean,
    ): Boolean = isReturnKey && keyDown && !shift && !fromSoftwareKeyboard
}
