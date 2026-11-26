# Radio Chaito

Radio Chaito is a self-contained, dependency-free radio player module for
Evolving Crisis. It is served directly at
`/modules/radio-chaito/` and can also be copied to another static host.

The player uses relative asset URLs, stores its settings in browser-local
storage, and includes synthesized demo audio. Replace `src: null` entries in
`app.js` with audio URLs to use real recordings.

The station name is **420 pb chaïto** (`pb` for *pares de bases*).

The light and dark surfaces follow the site's Solarized theme (`#fdf6e3` and
`#002b36`), with the Solarized orange accent reserved for playback activity.
The standalone player opens in a dormant, low-activity state: audio and the
visualizer start only after tuning in, and the canvas animation and progress
timer stop when playback is paused. The same player can also run in the
compact site-header embed.

Run it locally from this directory with:

```sh
python3 -m http.server 8000
```
