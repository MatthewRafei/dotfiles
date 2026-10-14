import QtQuick
import Quickshell
import qs
import qs.widgets

// Quick panel page (qs ipc call quick agents): search on top, sessions that need
// you or are working, projects (folders) to start in or filter by, then every
// session: the idle ones still running and all saved conversations, which only
// leave the list when deleted (to the Trash). Sync at the bottom.
Column {
    id: page
    property var service
    property var panel

    property string project: ""           // filter: only this folder's sessions
    readonly property string query: search.text.trim()
    // "~/x" or "/x" typed: offer to start a session there
    readonly property bool queryIsPath: /^[~\/]/.test(query)
    readonly property string queryDir: query.replace(/^~(?=\/|$)/, service.home)

    function matches(it) {
        if (project !== "" && it.cwd !== project) return false
        if (query === "") return true
        const hay = (it.title + " " + (it.prompt || "") + " " + service.pretty(it.cwd || "")).toLowerCase()
        return query.toLowerCase().split(/\s+/).every(w => hay.indexOf(w) >= 0)
    }
    // folder name, with its parent when two projects share a name (~/x/compiler-tutor, ~/compiler-tutor)
    function baseName(dir) { return dir.split("/").filter(x => x).pop() || dir }
    readonly property var dupNames: {
        const seen = {}, dup = {}
        for (const p of service.projects) { const b = baseName(p.dir); if (seen[b]) dup[b] = true; seen[b] = true }
        return dup
    }
    function projectName(dir) {
        if (dir === service.home) return "~  home"
        const b = baseName(dir)
        return dupNames[b] ? b + "  ·  " + service.pretty(dir.slice(0, dir.length - b.length - 1)) : b
    }

    readonly property var shown: service.library.filter(matches)
    readonly property var shownProjects: service.projects.filter(p => query === "" || queryIsPath
        || (projectName(p.dir) + " " + service.pretty(p.dir)).toLowerCase().indexOf(query.toLowerCase()) >= 0)

    // two-click button: icon, then a red word to confirm within 3 s
    component ConfirmButton: Rectangle {
        id: cb
        property string icon
        property string confirm
        property bool armed: false
        signal confirmed()

        width: armed ? cbText.implicitWidth + 12 : 22
        height: 22
        radius: Theme.radius
        color: armed ? Theme.alpha(Theme.danger, 0.15) : "transparent"
        border.color: armed || cbMouse.containsMouse ? Theme.danger : Theme.border
        Text {
            id: cbText
            anchors.centerIn: parent
            text: cb.armed ? cb.confirm : cb.icon
            color: cb.armed || cbMouse.containsMouse ? Theme.danger : Theme.textDim
            font.family: cb.armed ? Theme.fontFamily : Theme.iconFont
            font.pixelSize: cb.armed ? 8 : 12
            font.bold: cb.armed
        }
        MouseArea {
            id: cbMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                if (cb.armed) { cb.armed = false; cb.confirmed() }
                else { cb.armed = true; cbDisarm.restart() }
            }
        }
        Timer { id: cbDisarm; interval: 3000; onTriggered: cb.armed = false }
    }

    // one session: a running one (status, kept or not, stop) or a saved
    // conversation (resume as kept, delete)
    component SessionRow: Rectangle {
        id: sr
        property var it                   // library item, or {kind: "live", s} for the live lists
        readonly property bool live: it.kind === "live"
        readonly property var s: live ? it.s : null
        readonly property string status: live ? s.status : "saved"
        readonly property bool openable: live || it.found
        readonly property color tint: status === "waiting" ? Theme.danger
            : status === "busy" ? Theme.accent : live ? Theme.text : Theme.textFaint

        width: parent ? parent.width : 0
        height: 40
        radius: Theme.radius
        color: srMouse.containsMouse && sr.openable ? Theme.bgCard : "transparent"

        Rectangle {
            width: 2
            height: parent.height - 12
            anchors.verticalCenter: parent.verticalCenter
            color: sr.tint
            visible: sr.status === "waiting" || sr.status === "busy"
        }

        // filled dot: running (pulsing while it works); ring: saved
        Rectangle {
            id: dot
            x: 14
            anchors.verticalCenter: parent.verticalCenter
            width: 8; height: 8; radius: 4
            color: sr.live ? sr.tint : "transparent"
            border.color: sr.tint
            border.width: sr.live ? 0 : 1
            SequentialAnimation on opacity {
                running: sr.status === "busy"
                loops: Animation.Infinite
                NumberAnimation { to: 0.25; duration: 700; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1; duration: 700; easing.type: Easing.InOutSine }
                onRunningChanged: if (!running) dot.opacity = 1
            }
        }

        Column {
            x: 32
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - x - tags.width - 16
            spacing: 2
            Text {
                width: parent.width
                elide: Text.ElideRight
                text: sr.it.title || "Untitled"
                color: sr.status === "waiting" ? Theme.danger : sr.openable ? Theme.text : Theme.textDim
                font.family: Theme.fontFamily
                font.pixelSize: 11
            }
            Text {
                width: parent.width
                elide: Text.ElideMiddle
                text: (sr.status === "waiting" ? "NEEDS YOU " : sr.status === "busy" ? "WORKING "
                       : sr.status === "new" ? "NEW " : sr.status === "view" ? "VIEW " : sr.live ? "RUNNING " : "")
                    + page.service.ago(sr.live ? sr.s.since : sr.it.when) + "  ·  "
                    + (sr.openable ? page.service.pretty(sr.it.cwd || "") : "FOLDER GONE  " + page.service.pretty(sr.it.cwd))
                color: Theme.textFaint
                font.family: Theme.fontFamily
                font.pixelSize: 8
                font.letterSpacing: 1
            }
        }

        Row {
            id: tags
            anchors.right: parent.right
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            spacing: 4

            // kept sessions survive their terminal; the others end with it
            Text {
                visible: sr.live
                anchors.verticalCenter: parent.verticalCenter
                text: !sr.live ? "" : sr.s.job ? "JOB" : sr.s.tmux !== "" ? (sr.s.attached > 0 ? "KEPT" : "KEPT · BG") : "TERMINAL"
                color: sr.live && (sr.s.tmux !== "" || sr.s.job) ? Theme.accent : Theme.textFaint
                font.family: Theme.fontFamily
                font.pixelSize: 8
                font.letterSpacing: 1
            }
            ConfirmButton {
                visible: sr.live && sr.s.tmux !== ""
                icon: "󰅖"
                confirm: "STOP?"
                onConfirmed: page.service.stop(sr.s)
            }
            ConfirmButton {
                visible: !sr.live
                icon: "󰆴"
                confirm: "DELETE?"
                onConfirmed: page.service.remove(sr.it.c)
            }
        }

        MouseArea {
            id: srMouse
            anchors.fill: parent
            z: -1
            hoverEnabled: true
            cursorShape: sr.openable ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: {
                if (!sr.openable) return
                page.panel.close()
                if (sr.live) page.service.open(sr.s)
                else page.service.newSession(sr.it.cwd, sr.it.sid)
            }
        }
    }

    // a slim scroll bar for the lists that scroll
    component ScrollHint: Rectangle {
        property Flickable view
        visible: view.contentHeight > view.height
        x: view.width - 3
        y: view.y + view.visibleArea.yPosition * view.height
        width: 2
        height: view.visibleArea.heightRatio * view.height
        radius: 1
        color: Theme.border
    }

    // live updates while it's open
    Binding { target: page.service; property: "fast"; value: true }
    Component.onCompleted: { service.refreshMore(); search.focusInput() }

    width: parent.width
    spacing: 4

    QuickHead {
        title: "// CLAUDE CODE  ·  " + page.service.sessions.filter(x => x.status !== "view").length + " RUNNING"
        showToggle: false
        showRescan: true
        onRescan: page.service.refreshMore()
    }

    Rectangle { width: parent.width; height: 1; color: Theme.border }

    // ------------------------------------------------ search
    HudField {
        id: search
        width: parent.width
        input.anchors.leftMargin: 30
        // the field's own placeholder hides on focus, and this one is focused on open
        Text {
            x: 10
            anchors.verticalCenter: parent.verticalCenter
            text: "󰍉"
            color: search.input.activeFocus ? Theme.accent : Theme.textFaint
            font.family: Theme.iconFont
            font.pixelSize: 13
        }
        Text {
            visible: search.text === ""
            x: 30
            anchors.verticalCenter: parent.verticalCenter
            text: "search sessions…  or ~/folder to start one"
            color: Theme.textFaint
            font.family: Theme.fontFamily
            font.pixelSize: 11
        }
        // enter: start in a typed folder, else open the first match
        onAccepted: {
            if (page.queryIsPath) {
                const d = page.queryDir
                text = ""
                page.panel.close()
                page.service.newSession(d, "")
            } else if (page.shown.length > 0) {
                const it = page.shown[0]
                if (it.kind === "live") { page.panel.close(); page.service.open(it.s) }
                else if (it.found) { page.panel.close(); page.service.newSession(it.cwd, it.sid) }
            }
        }
    }
    QuickRow {
        visible: page.queryIsPath
        height: 30
        icon: "󰐕"
        label: "New session in " + page.service.pretty(page.queryDir)
        detail: "ENTER"
        onClicked: { const d = page.queryDir; search.text = ""; page.panel.close(); page.service.newSession(d, "") }
    }

    // ------------------------------------------------ live
    QuickLabel { visible: page.service.waiting.length > 0; text: "NEEDS YOU"; color: Theme.danger }
    Repeater { model: page.service.waiting; SessionRow { required property var modelData; it: ({ kind: "live", s: modelData, title: modelData.title, cwd: modelData.cwd }) } }
    QuickLabel { visible: page.service.busy.length > 0; text: "WORKING" }
    Repeater { model: page.service.busy; SessionRow { required property var modelData; it: ({ kind: "live", s: modelData, title: modelData.title, cwd: modelData.cwd }) } }

    // ------------------------------------------------ projects
    QuickLabel { visible: page.shownProjects.length > 0; text: "PROJECTS  ·  CLICK TO FILTER, + TO START" }
    Item {
        visible: page.shownProjects.length > 0
        width: parent.width
        height: projView.height
        Flickable {
            id: projView
            width: parent.width
            height: Math.min(projCol.implicitHeight, 5 * 30)
            contentHeight: projCol.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            Column {
                id: projCol
                width: projView.width
                Repeater {
                    model: page.shownProjects
                    Item {
                        id: pr
                        required property var modelData
                        readonly property bool here: page.project === modelData.dir
                        width: projCol.width
                        height: 30
                        QuickRow {
                            width: parent.width - plus.width - 6
                            height: parent.height
                            icon: pr.here ? "󰉖" : "󰉋"
                            active: pr.here
                            label: page.projectName(pr.modelData.dir)
                            detail: pr.modelData.count > 0 ? String(pr.modelData.count) : ""
                            onClicked: page.project = pr.here ? "" : pr.modelData.dir
                        }
                        Rectangle {
                            id: plus
                            anchors.right: parent.right
                            anchors.rightMargin: 4
                            anchors.verticalCenter: parent.verticalCenter
                            width: 22; height: 22
                            radius: Theme.radius
                            color: plusMouse.containsMouse ? Theme.alpha(Theme.accent, 0.15) : "transparent"
                            border.color: plusMouse.containsMouse ? Theme.accent : Theme.border
                            Text {
                                anchors.centerIn: parent
                                text: "󰐕"
                                color: plusMouse.containsMouse ? Theme.accent : Theme.textDim
                                font.family: Theme.iconFont
                                font.pixelSize: 12
                            }
                            MouseArea {
                                id: plusMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: { page.panel.close(); page.service.newSession(pr.modelData.dir, "") }
                            }
                        }
                    }
                }
            }
        }
        ScrollHint { view: projView }
    }

    // ------------------------------------------------ sessions
    Item {
        width: parent.width
        height: sessLabel.implicitHeight
        QuickLabel {
            id: sessLabel
            text: "SESSIONS  ·  " + page.shown.length
                + (page.project !== "" ? "  ·  " + page.projectName(page.project).toUpperCase() : "")
        }
        // clear the project filter
        Text {
            visible: page.project !== ""
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            text: "SHOW ALL  ✕"
            color: clearMouse.containsMouse ? Theme.accent : Theme.textFaint
            font.family: Theme.fontFamily
            font.pixelSize: 9
            font.letterSpacing: 2
            MouseArea {
                id: clearMouse
                anchors.fill: parent
                anchors.margins: -4
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: page.project = ""
            }
        }
    }
    Text {
        visible: page.shown.length === 0
        text: page.service.library.length === 0 ? "NO SESSIONS YET" : "NOTHING MATCHES"
        color: Theme.textFaint
        font.family: Theme.fontFamily
        font.pixelSize: 9
        font.letterSpacing: 2
        topPadding: 4
        bottomPadding: 4
    }
    Item {
        visible: page.shown.length > 0
        width: parent.width
        height: sessView.height
        Flickable {
            id: sessView
            width: parent.width
            height: Math.min(sessCol.implicitHeight, 9 * 40)
            contentHeight: sessCol.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            Column {
                id: sessCol
                width: sessView.width
                Repeater {
                    model: page.shown
                    SessionRow { required property var modelData; it: modelData }
                }
            }
        }
        ScrollHint { view: sessView }
    }

    // ------------------------------------------------ sync
    // claude-sync.py: only once its staging folder exists
    QuickLabel {
        visible: page.service.syncEnabled
        text: "SYNC  ·  " + ((page.service.sync.peers || []).map(p => p.host.toUpperCase()).join(", ")
                          || "NO OTHER MACHINE YET")
    }
    QuickRow {
        visible: page.service.syncEnabled
        width: parent.width
        height: 30
        icon: "󰓦"
        busy: page.service.syncing
        label: page.service.syncing ? "Syncing…"
            : page.service.sync.lastPull ? "Synced " + page.service.ago(page.service.sync.lastPull) + " ago"
            : "Never synced"
        detail: (page.service.sync.conflicts ? page.service.sync.conflicts + " CONFLICT" + (page.service.sync.conflicts > 1 ? "S  ·  " : "  ·  ") : "")
            + (page.service.sync.pending ? page.service.sync.pending + " TO PUSH" : "SYNC NOW")
        onClicked: page.service.syncNow()
    }
}
