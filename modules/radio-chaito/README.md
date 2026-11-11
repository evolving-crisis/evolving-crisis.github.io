# Radio Chaito

Radio Chaito is a self-contained, dependency-free radio player module for
Evolving Crisis. It is served directly at
`/modules/radio-chaito/` and can also be copied to another static host.

The player uses relative asset URLs, stores its settings in browser-local
storage, and includes synthesized demo audio. Replace `src: null` entries in
`app.js` with audio URLs to use real recordings.

The light and dark surfaces follow the site's Solarized theme (`#fdf6e3` and
`#002b36`), while the Solarized orange accent is reserved for playback and
visualizer activity. The same player can therefore run standalone or in the
compact site-header embed without introducing a separate visual language.

Run it locally from this directory with:

```sh
python3 -m http.server 8000
```
