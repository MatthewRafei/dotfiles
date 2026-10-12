import QtQuick
import Quickshell.Io

// clawd, the claude code critter: pixel runs on a 16x10 grid, eyes left as
// holes. One cell = a whole number of device pixels (`cell` of them), or
// fractional scaling (1.25) rounds the two sides differently.
// Screen.devicePixelRatio is the rounded-up output scale (2 at 1.25), so the
// real one comes from niri, asked once per instance.
Item {
    id: clawd
    property color color: "#C15F3C"
    property int cell: 2                // device pixels per cell
    property string output: ""          // niri output name; "" = the first
    property real outScale: 1
    readonly property real px: cell / outScale

    width: 16 * px
    height: 10 * px

    Process {
        running: true
        command: ["niri", "msg", "-j", "outputs"]
        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    const outs = JSON.parse(text)
                    const o = outs[clawd.output] || outs[Object.keys(outs)[0]]
                    if (o && o.logical && o.logical.scale > 0) clawd.outScale = o.logical.scale
                } catch (e) {}
            }
        }
    }

    Repeater {
        model: [[2,0,12,2], [2,2,2,2], [5,2,6,2], [12,2,2,2], [0,4,16,2],
                [2,6,12,2], [3,8,1,2], [5,8,1,2], [10,8,1,2], [12,8,1,2]]
        Rectangle {
            required property var modelData
            x: modelData[0] * clawd.px
            y: modelData[1] * clawd.px
            width: modelData[2] * clawd.px
            height: modelData[3] * clawd.px
            color: clawd.color
            antialiasing: false
        }
    }
}
