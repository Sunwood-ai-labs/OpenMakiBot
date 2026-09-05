package com.openmausbot.companion.ui

import com.openmausbot.companion.core.BotOverview
import com.openmausbot.companion.core.BotOverviewWho
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * "What this bot does" — the copy and the two section-visibility decisions
 * behind [BotOverviewScreen].
 */
class OverviewRulesTest {
    private fun overview(
        does: List<String> = emptyList(),
        reaches: List<String> = emptyList(),
        wont: List<String> = emptyList(),
        recent: List<com.openmausbot.companion.core.BotOverviewRecent> = emptyList(),
    ) = BotOverview(
        who = BotOverviewWho(name = "Maus", title = "Assistant", blurb = "", soulLead = ""),
        does = does,
        reaches = reaches,
        wont = wont,
        recent = recent,
    )

    @Test
    fun `the title names the bot`() {
        assertEquals("What Maus does", OverviewRules.title("Maus"))
    }

    @Test
    fun `reaches is shown only when the server sent something`() {
        assertFalse(OverviewRules.showsReaches(overview(reaches = emptyList())))
        assertTrue(OverviewRules.showsReaches(overview(reaches = listOf("Email"))))
    }

    @Test
    fun `wont is shown only when the server sent something`() {
        assertFalse(OverviewRules.showsWont(overview(wont = emptyList())))
        assertTrue(OverviewRules.showsWont(overview(wont = listOf("Delete files"))))
    }
}
