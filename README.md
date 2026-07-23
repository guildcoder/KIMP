# KIMP Radio — GitHub Pages Station

A static, mobile-first radio-style web app that shuffles an approved list of SoundCloud URLs and inserts local MP3 station IDs or fictional advertisements.

## Important technical limitation

This site uses the official SoundCloud embedded Widget API. It can play SoundCloud within the KIMP page, but SoundCloud audio remains inside a cross-origin iframe. The site can fade the widget volume down before a local MP3 and fade between program elements, but it cannot perform sample-accurate DJ mixing or overlap/process SoundCloud audio through the Web Audio API.

Background playback works where the browser permits it after the listener presses **Tune In**. Continuous audio within a track is generally more reliable than automatically loading the next SoundCloud track while an iPhone is locked, because iOS may suspend page JavaScript. For guaranteed uninterrupted locked-screen radio, use a real continuous Icecast/HLS stream produced by a server rather than GitHub Pages.

## Add the SoundCloud rotation

Edit `songs.txt`. Put one public, embeddable SoundCloud track or playlist URL on each line:

```txt
https://soundcloud.com/artist/track-name
https://soundcloud.com/artist/another-track
```

Blank lines and lines beginning with `#` are ignored.

## Add advertisements

1. Copy MP3 files into the `ads/` folder.
2. List each path in `ads.txt`:

```txt
ads/kimp-station-id.mp3
ads/impact-title-ad.mp3
```

The default rotation inserts an ad after a random 3–5 songs. Change these values near the top of `app.js`:

```js
songsBetweenAdsMin: 3,
songsBetweenAdsMax: 5,
```

## Publish on GitHub Pages

1. Create a new GitHub repository.
2. Upload every file and folder from this package to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the Pages URL GitHub provides.

## Mobile testing checklist

- Test in Safari on iPhone and Chrome on Android.
- Tap **Tune In** before locking the phone; autoplay without a user gesture is intentionally blocked on mobile.
- Leave the station tab open.
- Confirm each SoundCloud URL permits embedding.
- Test song-to-song and song-to-ad transitions while the screen is locked.
- On iPhone, compare regular Safari with **Add to Home Screen**. OS releases can behave differently.

## Local testing

Do not open `index.html` directly from the filesystem because browsers block `fetch()` for the text lists. Run a small local server from this folder:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.
