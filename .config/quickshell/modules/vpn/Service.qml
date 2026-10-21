import Quickshell
import Quickshell.Io
import QtQuick
import qs

// Tailscale state for the bar chip and the VPN dropdown (QuickPanel.qml).
// Polls `tailscale status --json`; faster while the dropdown is open.
//
// Changing state (up / down / exit node) needs the user to be Tailscale's
// operator, once: doas tailscale set --operator=$USER
Scope {
    id: root

    property bool installed: false       // tailscale CLI found and daemon answered
    property string state: ""            // Running, Stopped, NeedsLogin, Starting, ...
    readonly property bool running: state === "Running"
    property string selfName: ""
    property string selfIp: ""
    property string tailnet: ""
    property string exitNode: ""         // host name of the exit node in use, "" = none
    property var peers: []               // [{ name, ip, os, online, exitOption, exit }]
    readonly property int onlineCount: peers.filter(p => p.online).length
    property string busy: ""             // what we're waiting for: "up", "down", "exit"
    property string error: ""
    property bool fast: false            // the dropdown is open

    function refresh() { if (!status.running) status.running = true }

    function up()   { act("up", ["tailscale", "up"]) }
    function down() { act("down", ["tailscale", "down"]) }
    function toggle() { running ? down() : up() }
    // ip of a peer, or "" for no exit node
    function useExit(ip) { act("exit", ["tailscale", "set", "--exit-node=" + ip]) }
    function copy(text) { Quickshell.execDetached(["wl-copy", text]) }

    // ---------------- off on home Wi-Fi ----------------
    // Per machine (~/.cache/quickshell/vpn.json). Joining a home network takes
    // Tailscale down; joining any other network brings it back, but only if
    // this turned it off. Only network changes act, so turning it on by hand
    // at home sticks until the next change.
    property alias homeAuto: st.homeAuto
    readonly property var homeSsids: st.homeSsids
    readonly property bool atHome: Net.ssid !== "" && st.homeSsids.indexOf(Net.ssid) >= 0

    function setHomeAuto(on) { st.homeAuto = on; homeCheck.restart() }
    function toggleHome(ssid) {
        if (ssid === "") return
        const list = st.homeSsids.filter(s => s !== ssid)
        if (list.length === st.homeSsids.length) list.push(ssid)
        st.homeSsids = list
        homeCheck.restart()
    }

    FileView {
        path: Quickshell.env("HOME") + "/.cache/quickshell/vpn.json"
        blockLoading: true
        watchChanges: true
        onFileChanged: reload()
        onAdapterUpdated: writeAdapter()
        onLoadFailed: err => { if (err === FileViewError.FileNotFound) writeAdapter() }

        JsonAdapter {
            id: st
            property bool homeAuto: true
            property var homeSsids: []
            property bool autoDown: false    // down because of a home network: bring it back on leaving
        }
    }

    // wait for the network to settle (roaming, resume) before acting
    Connections {
        target: Net
        function onSsidChanged() { homeCheck.restart() }
        function onEthIfaceChanged() { homeCheck.restart() }
    }
    onStateChanged: if (homeCheck.pending) homeCheck.restart()
    Timer {
        id: homeCheck
        property bool pending: true          // also once at startup, when the state is known
        interval: 4000
        running: true
        onTriggered: {
            if (root.state === "" || root.busy !== "") return   // pending: retried on the next state change
            pending = false
            if (!st.homeAuto) return
            const online = Net.ssid !== "" || Net.ethIface !== ""
            if (root.atHome) {
                if (root.running) { st.autoDown = true; root.down() }
            } else if (online && st.autoDown) {
                st.autoDown = false
                if (root.state === "Stopped") root.up()
            }
        }
        onRunningChanged: if (running) pending = true
    }

    function act(what, cmd) {
        if (action.running) return
        busy = what
        error = ""
        action.command = cmd
        action.running = true
    }

    Timer {
        interval: root.fast ? 2000 : 8000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }

    Process {
        id: status
        command: ["tailscale", "status", "--json"]
        stdout: StdioCollector {
            onStreamFinished: {
                let d = null
                try { d = JSON.parse(text) } catch (e) {}
                if (!d) { root.installed = false; root.state = ""; return }
                root.installed = true
                root.state = d.BackendState || ""
                const self = d.Self || {}
                root.selfName = self.HostName || ""
                root.selfIp = (self.TailscaleIPs || [])[0] || ""
                root.tailnet = (d.CurrentTailnet || {}).Name || ""
                const list = []
                let exit = ""
                for (const k in (d.Peer || {})) {
                    const p = d.Peer[k]
                    const name = p.HostName || (p.DNSName || "").split(".")[0]
                    if (p.ExitNode) exit = name
                    list.push({ name: name, ip: (p.TailscaleIPs || [])[0] || "", os: p.OS || "",
                                online: !!p.Online, exitOption: !!p.ExitNodeOption, exit: !!p.ExitNode })
                }
                // online first, then by name
                list.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
                root.peers = list
                root.exitNode = exit
            }
        }
        // not installed / daemon not running
        onExited: code => { if (code !== 0 && root.state === "") root.installed = false }
    }

    Process {
        id: action
        stderr: StdioCollector {
            onStreamFinished: {
                const t = text.trim()
                if (t === "") return
                root.error = t.indexOf("operator") >= 0 || t.indexOf("Access denied") >= 0
                    ? "Not allowed yet. Run once:  doas tailscale set --operator=$USER"
                    : t.split("\n")[0]
            }
        }
        onExited: {
            root.busy = ""
            root.refresh()
        }
    }
}
