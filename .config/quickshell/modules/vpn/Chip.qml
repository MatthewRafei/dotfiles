import QtQuick
import Quickshell
import qs
import qs.widgets

// tailscale: dim when stopped, accent through an exit node (its name is
// in the dropdown). click = VPN dropdown, right-click = connect / disconnect
BarChip {
    property var service
    property var bar

    shown: service.installed
    icon: "󰖂"
    accent: !service.running ? Theme.textFaint
          : service.exitNode !== "" ? Theme.accent
          : Theme.text
    onClicked: mouse => {
        if (mouse.button === Qt.RightButton)
            service.toggle()
        else
            Quickshell.execDetached(["qs", "ipc", "call", "quick", "vpn"])
    }
}
