pragma Singleton
import Quickshell
import QtQuick

// Session state the core shares with modules (set from shell.qml).
Singleton {
    property bool locked: false      // the lock screen is up

    // A watcher that only prints when something happens (nmcli monitor,
    // udevadm monitor, dbus-monitor) never notices the shell going away, so
    // every restart or crash left one running. Wrapped in this it gets
    // SIGTERM when the shell dies; without setpriv (util-linux) it runs as-is.
    function tied(cmd) {
        return ["sh", "-c", 'command -v setpriv >/dev/null && exec setpriv --pdeathsig TERM -- "$@"; exec "$@"', "sh"]
            .concat(cmd)
    }
}
