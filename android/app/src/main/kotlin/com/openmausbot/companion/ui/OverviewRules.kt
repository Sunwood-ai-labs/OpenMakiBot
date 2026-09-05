package com.openmausbot.companion.ui

import com.openmausbot.companion.core.BotOverview

/**
 * "What this bot does", as rules — the copy and small decisions behind
 * [BotOverviewScreen].
 *
 * Everything the screen shows is server-authored prose (`who`, `does`,
 * `reaches`, `wont`, `recent`): there is nothing here to validate or compute,
 * only what to say when a section is empty and which sections are worth
 * showing at all.
 */
object OverviewRules {
    fun title(name: String): String = "What $name does"

    const val EMPTY_DOES: String = "Nothing scheduled or learned yet."
    const val EMPTY_RECENT: String = "No changes recorded yet."
    const val FAILED: String = "Couldn't load the overview."

    const val WHO: String = "Who"
    const val DOES: String = "Does"
    const val REACHES: String = "Reaches"
    const val WONT: String = "Won't"
    const val RECENT: String = "Recent"

    /**
     * "Reaches" and "won't" are optional detail: the server sends them only
     * when there is something specific to say, and an empty list is not a
     * claim that the agent reaches or refuses nothing — unlike [DOES] and
     * [RECENT], which are always meaningful (a bot that does nothing yet, or
     * has no history yet, is still worth a sentence). So these two sections
     * are omitted rather than shown with filler copy.
     */
    fun showsReaches(overview: BotOverview): Boolean = overview.reaches.isNotEmpty()

    fun showsWont(overview: BotOverview): Boolean = overview.wont.isNotEmpty()
}
