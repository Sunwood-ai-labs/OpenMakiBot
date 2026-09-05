import CompanionCore
import SwiftUI

/// A read-only summary of one bot: who it is, what it does, what it can
/// reach, what it won't do, and its recent activity. No settings and no
/// transcript live here — this mirrors the paired-safe `BotOverview` payload
/// exactly. Shell copied from `ConnectedAppsView`.
struct BotOverviewView: View {
    let bot: Bot

    @EnvironmentObject private var session: Session
    @State private var overview: BotOverview?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        List {
            if let overview {
                Section("Who") {
                    Text(overview.who.name).font(.headline)
                    Text(overview.who.title)
                    Text(overview.who.blurb)
                    Text(overview.who.soulLead)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Does") {
                    if overview.does.isEmpty {
                        Text("Nothing scheduled or learned yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(overview.does, id: \.self) { line in
                            Label(line, systemImage: "calendar.badge.clock")
                        }
                    }
                }

                Section("Can reach") {
                    ForEach(overview.reaches, id: \.self) { line in
                        Label(line, systemImage: "network")
                    }
                }

                Section("Won't") {
                    ForEach(overview.wont, id: \.self) { line in
                        Label(line, systemImage: "hand.raised")
                    }
                }

                Section("Recent changes") {
                    if overview.recent.isEmpty {
                        Text("No changes recorded yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(overview.recent.enumerated()), id: \.offset) { _, change in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.summary)
                                Text(Date(timeIntervalSince1970: change.at / 1_000).formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else if failed {
                Section {
                    ContentUnavailableView("Couldn't load", systemImage: "wifi.exclamationmark")
                }
            }
        }
        .navigationTitle("What \(bot.name) does")
        .overlay { if loading && overview == nil { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        if let loaded = await session.botOverview(for: bot) {
            overview = loaded
            failed = false
        } else {
            failed = true
        }
    }
}
