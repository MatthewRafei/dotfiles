# Skits

The little animations that play in the bar in place of the quote
(`bar/Quote.qml`). Every `*.skit` file in this folder is read when the
shell starts, or when you run `qs ipc call bar reload`. Parsing is done by
`bar/skits.js`, and problems show up in `qs log` as `skits: file:line ...`.

    qs ipc call bar list          names of all skits
    qs ipc call bar skit <name>   play one (event skits work too)
    qs ipc call bar peek          play a random one

## Format

```
# a comment (only at the start of a line)

@name                     a skit in the random pool
!name                     an event skit: played when something happens
                          (charger, wifi, ...), never at random

MS [flags] | text         one frame, shown for MS milliseconds
200-400 | text            ...or a random time in that range
```

Flags: `sparkle` (the ✧ next to the face), and a colour: `danger`,
`accent2` or `dim` (the default is the accent colour). There is exactly
one space after the `|`. Spaces after that one are part of the text, so
you can indent things.

```
type MS [flags] | pre«typed»post     one frame per character of «typed»,
                                     as if typed out
erase MS [flags] | pre«gone»post     the reverse: «gone» shrinks away

repeat N                             the lines up to `end`, N times
  ...
end

gen NAME [args]                      frames made in code:
                                       progress [steps]  a loading bar
                                       pacman            Pac-Man vs. a ghost
                                       belt [glyph]      a Factorio belt
                                       rain              Matrix rain
```

Inside a frame's text:

- `{a|b}` alternates: `a` on even steps of a `repeat` or `type`/`erase`,
  `b` on odd ones (more options cycle).
- `{?a|b|c}` picks one at random each time.
- `{name}` is a value passed in by an event skit, like `{battery}`.
- `\{` is a plain `{`, for when the text itself has braces.

The first frame of a skit decodes in from noise and the last one
dissolves away, so a skit only needs its middle.
