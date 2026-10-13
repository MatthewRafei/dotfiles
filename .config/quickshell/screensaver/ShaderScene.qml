import QtQuick
import QtQuick.Window

// Generic host for the screensaver's shader scenes (ctx.native with a `frag`):
// one ShaderEffect running a baked .qsb with the same uniforms every time, so a
// new scene is a fragment shader in shaders/ plus a shaderScene() line in
// ScreensaverScenes.js. Like MatrixRain.qml, the CPU only advances a clock
// 30 times a second.
//
// Uniforms (std140 block, in this order; see shaders/topo.frag):
//   mat4 qt_Matrix; float qt_Opacity; vec2 size; float time;
//   vec4 accent; vec4 accent2; vec4 bg; vec4 fg;
// A scene that asks for `glyphs` also gets (after fg; see shaders/donut.frag)
//   vec2 cell; float glyphCount;   and   sampler2D atlas (binding 1):
// the glyphs laid out once in the shell's font, one per cell, white on clear.
// A scene that asks for the wallpaper gets sampler2D wall (binding 2), the
// wallpaper cropped to the screen, and fog (binding 3), the same at a twelfth
// of the size: sampled smoothly, a cheap blur (see shaders/rain.frag).
Item {
    id: host

    property bool playing: true
    property url frag
    // the wallpaper palette; Screensaver.qml binds these to Theme
    property color accent: "#ffffff"
    property color accent2: "#888888"
    property color bg: "#050506"
    property color fg: "#ffffff"

    // optional glyph atlas for ASCII-style shaders
    property string glyphs: ""
    property string fontFamily: "monospace"
    readonly property bool hasAtlas: glyphs !== ""

    // optional wallpaper textures; Screensaver.qml binds `wallpaper` to Theme
    property bool useWallpaper: false
    property string wallpaper: ""
    // one cell of the ASCII scenes' grid (13 px text, as in Screensaver.qml)
    readonly property real cellW: Math.max(1, probe.implicitWidth / 40)
    readonly property real cellH: Math.ceil(fm.height)

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

    FontMetrics {
        id: fm
        font.family: host.fontFamily
        font.pixelSize: 13
    }
    Text {
        id: probe
        visible: false
        text: "M".repeat(40)
        font.family: host.fontFamily
        font.pixelSize: 13
    }

    // the glyphs, one per cell. Never shown directly.
    Row {
        id: atlasRow
        visible: false
        Repeater {
            model: host.glyphs.length
            Text {
                required property int index
                width: host.cellW
                height: host.cellH
                text: host.glyphs.charAt(index)
                color: "white"
                font.family: host.fontFamily
                font.pixelSize: 13
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                textFormat: Text.PlainText
            }
        }
    }

    ShaderEffectSource {
        id: glyphAtlas
        sourceItem: host.hasAtlas ? atlasRow : null
        hideSource: true
        // live: a hidden surface drops its GPU resources, and a static capture
        // would come back empty the next time the screensaver shows
        live: true
        textureSize: Qt.size(Math.max(1, atlasRow.width * Screen.devicePixelRatio), Math.max(1, atlasRow.height * Screen.devicePixelRatio))
        smooth: true
        visible: false
    }

    // the wallpaper as it fills the screen. Never shown directly.
    Image {
        id: wallImage
        visible: false
        width: host.width
        height: host.height
        source: host.useWallpaper && host.wallpaper !== "" ? "file://" + host.wallpaper : ""
        sourceSize: Qt.size(Math.max(1, host.width * Screen.devicePixelRatio), Math.max(1, host.height * Screen.devicePixelRatio))
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        smooth: true
    }
    ShaderEffectSource {
        id: wallSharp
        sourceItem: host.useWallpaper ? wallImage : null
        hideSource: true
        live: true
        textureSize: Qt.size(Math.max(1, host.width * Screen.devicePixelRatio), Math.max(1, host.height * Screen.devicePixelRatio))
        smooth: true
        visible: false
    }
    ShaderEffectSource {
        id: wallFog
        sourceItem: host.useWallpaper ? wallImage : null
        hideSource: true
        live: true
        textureSize: Qt.size(Math.max(1, Math.round(host.width / 12)), Math.max(1, Math.round(host.height / 12)))
        smooth: true
        visible: false
    }

    // made only once there is a shader: an empty fragmentShader falls back to
    // Qt's default one, which warns about a missing `source`. Shaders that
    // don't declare the atlas or wallpaper members just ignore them.
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
            property size cell: Qt.size(host.cellW, host.cellH)
            property real glyphCount: Math.max(1, host.glyphs.length)
            property variant atlas: glyphAtlas
            property variant wall: wallSharp
            property variant fog: wallFog
        }
    }
}
