import QtQuick

// Generic host for the screensaver's shader scenes (ctx.native with a `frag`):
// one ShaderEffect running a baked .qsb with the same uniforms every time, so a
// new scene is a fragment shader in shaders/ plus a shaderScene() line in
// ScreensaverScenes.js. Like MatrixRain.qml, the CPU only advances a clock
// 30 times a second.
//
// Uniforms (std140 block, in this order; see shaders/topo.frag):
//   mat4 qt_Matrix; float qt_Opacity; vec2 size; float time;
//   vec4 accent; vec4 accent2; vec4 bg; vec4 fg;
Item {
    id: host

    property bool playing: true
    property url frag
    // the wallpaper palette; Screensaver.qml binds these to Theme
    property color accent: "#ffffff"
    property color accent2: "#888888"
    property color bg: "#050506"
    property color fg: "#ffffff"

    property real time: 0
    FrameAnimation {
        running: host.playing && host.visible && host.width > 0
        property real pending: 0
        onTriggered: {
            pending += frameTime
            if (pending < 1 / 30) return
            host.time = (host.time + Math.min(pending, 0.1)) % 10000
            pending = 0
        }
    }

    // made only once there is a shader: an empty fragmentShader falls back to
    // Qt's default one, which warns about a missing `source`
    Loader {
        anchors.fill: parent
        active: host.frag.toString() !== ""
        sourceComponent: ShaderEffect {
            fragmentShader: host.frag
            onStatusChanged: if (status === ShaderEffect.Error) console.log("screensaver: shader", host.frag, log)

            property size size: Qt.size(width, height)
            property real time: host.time
            property color accent: host.accent
            property color accent2: host.accent2
            property color bg: host.bg
            property color fg: host.fg
        }
    }
}
