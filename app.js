const CONFIG = {
  songsFile: './songs.txt',
  adsFile: './ads.txt',
  songsBetweenAdsMin: 3,
  songsBetweenAdsMax: 5,
  defaultVolume: 78,
  widgetReadyTimeoutMs: 12000,
};

const els = {
  iframe: document.querySelector('#soundcloudPlayer'),
  ad: document.querySelector('#adPlayer'),
  play: document.querySelector('#playButton'),
  playIcon: document.querySelector('.play-icon'),
  playCopy: document.querySelector('.button-copy'),
  skip: document.querySelector('#skipButton'),
  volume: document.querySelector('#volumeSlider'),
  now: document.querySelector('#nowPlaying'),
  source: document.querySelector('#sourceLabel'),
  signal: document.querySelector('#signalText'),
  queue: document.querySelector('#queueStatus'),
  progress: document.querySelector('#progressBar'),
  elapsed: document.querySelector('#elapsed'),
  duration: document.querySelector('#duration'),
  lamp: document.querySelector('#onAirLamp'),
  needle: document.querySelector('#dialNeedle'),
};

let widget = null;
let widgetReadyPromise = null;
let songs = [];
let ads = [];
let songBag = [];
let adBag = [];
let activeType = null;
let activeItem = null;
let playing = false;
let transitioning = false;
let tracksUntilAd = randomInt(CONFIG.songsBetweenAdsMin, CONFIG.songsBetweenAdsMax);
let currentDurationMs = 0;

async function loadList(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${path.replace('./', '')}`);
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

async function boot() {
  els.play.disabled = true;
  try {
    [songs, ads] = await Promise.all([loadList(CONFIG.songsFile), loadList(CONFIG.adsFile)]);
    if (!songs.length) throw new Error('songs.txt has no SoundCloud URLs.');
    resetSongBag();
    resetAdBag();
    els.queue.textContent = `${songs.length} CUT${songs.length === 1 ? '' : 'S'} · ${ads.length} SPOT${ads.length === 1 ? '' : 'S'} IN ROTATION`;
    els.signal.textContent = 'SIGNAL READY';
    els.play.disabled = false;
  } catch (error) {
    showError(error);
  }
}

function resetSongBag() { songBag = shuffle([...songs]); }
function resetAdBag() { adBag = shuffle([...ads]); }
function nextSong() { if (!songBag.length) resetSongBag(); return songBag.pop(); }
function nextAd() { if (!adBag.length) resetAdBag(); return adBag.pop(); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function filenameTitle(path) {
  return decodeURIComponent(path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
}

function showError(error) {
  console.error(error);
  els.now.textContent = `SIGNAL ERROR — ${error.message || error}`.toUpperCase();
  els.queue.textContent = 'CHECK SONG URLS / NETWORK';
  els.signal.textContent = 'SIGNAL LOST';
  els.play.disabled = false;
  transitioning = false;
  setPlayingUI(false);
}

function setPlayingUI(value) {
  playing = value;
  els.play.classList.toggle('playing', value);
  els.lamp.classList.toggle('active', value);
  els.playIcon.textContent = value ? 'Ⅱ' : '▶';
  els.playCopy.textContent = value ? 'SIGNAL LIVE' : 'TUNE IN';
}

function ensureSoundCloudApi() {
  if (window.SC && typeof window.SC.Widget === 'function') return;
  throw new Error('SoundCloud player API did not load. Disable content blocking for this page and retry.');
}

function initializeWidget() {
  if (widgetReadyPromise) return widgetReadyPromise;

  widgetReadyPromise = new Promise((resolve, reject) => {
    try {
      ensureSoundCloudApi();
      const seedUrl = songs[0];
      els.iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(seedUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`;
      widget = window.SC.Widget(els.iframe);

      const timeout = window.setTimeout(() => {
        reject(new Error('SoundCloud player timed out. Confirm the track is public and embeddable.'));
      }, CONFIG.widgetReadyTimeoutMs);

      widget.bind(window.SC.Widget.Events.READY, () => {
        window.clearTimeout(timeout);
        widget.setVolume(Number(els.volume.value));
        widget.bind(window.SC.Widget.Events.FINISH, () => advance());
        widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, data => updateProgress(data.currentPosition, currentDurationMs));
        widget.bind(window.SC.Widget.Events.PLAY, () => setPlayingUI(true));
        widget.bind(window.SC.Widget.Events.PAUSE, () => {
          if (!transitioning && activeType === 'song') setPlayingUI(false);
        });
        resolve(widget);
      });

      widget.bind(window.SC.Widget.Events.ERROR, () => {
        reject(new Error('SoundCloud rejected this track. Use a public track with embedding enabled.'));
      });
    } catch (error) {
      reject(error);
    }
  });

  els.ad.volume = Number(els.volume.value) / 100;
  els.ad.addEventListener('timeupdate', () => updateProgress(els.ad.currentTime * 1000, els.ad.duration * 1000));
  els.ad.addEventListener('ended', () => advance());
  els.ad.addEventListener('play', () => setPlayingUI(true));
  els.ad.addEventListener('pause', () => {
    if (!transitioning && activeType === 'ad') setPlayingUI(false);
  });
  els.ad.addEventListener('error', () => {
    console.warn(`Skipping unavailable ad: ${activeItem}`);
    transitioning = false;
    advance({ forceSong: true });
  });

  return widgetReadyPromise;
}

function loadWidgetTrack(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) reject(new Error('The SoundCloud track did not load.'));
    }, CONFIG.widgetReadyTimeoutMs);

    widget.load(url, {
      auto_play: false,
      hide_related: true,
      show_comments: false,
      show_user: false,
      show_reposts: false,
      visual: false,
      callback: () => {
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      },
    });
  });
}

async function playSong(url) {
  transitioning = true;
  activeType = 'song';
  activeItem = url;
  els.ad.pause();
  els.ad.removeAttribute('src');
  els.source.textContent = 'KIMP MUSIC ROTATION';
  els.now.textContent = 'TUNING SOUNDCLOUD FREQUENCY…';
  els.needle.style.left = `${randomInt(15, 88)}%`;
  currentDurationMs = 0;
  updateProgress(0, 0);

  try {
    await initializeWidget();
    await loadWidgetTrack(url);
    widget.setVolume(Number(els.volume.value));

    await new Promise(resolve => {
      widget.getCurrentSound(sound => {
        const title = sound?.title || 'UNKNOWN TRANSMISSION';
        const artist = sound?.user?.username || 'KIMP ROTATION';
        currentDurationMs = sound?.duration || 0;
        els.now.textContent = `${artist} — ${title}`.toUpperCase();
        els.duration.textContent = formatTime(currentDurationMs);
        setMediaMetadata(title, artist, 'KIMP Radio');
        resolve();
      });
    });

    // This play call remains inside the original Tune In interaction chain on first use.
    widget.play();
    transitioning = false;
  } catch (error) {
    showError(error);
  }
}

async function playAd(path) {
  transitioning = true;
  activeType = 'ad';
  activeItem = path;
  if (widget) widget.pause();
  els.source.textContent = 'PAID TRANSMISSION';
  const title = filenameTitle(path);
  els.now.textContent = `KIMP SPONSOR MESSAGE — ${title}`.toUpperCase();
  els.needle.style.left = `${randomInt(8, 25)}%`;
  els.ad.src = path;
  els.ad.volume = Number(els.volume.value) / 100;
  setMediaMetadata(title, 'KIMP Sponsor Desk', 'Paid Transmission');

  try {
    await els.ad.play();
    transitioning = false;
  } catch (error) {
    console.warn('Skipping unavailable ad', error);
    transitioning = false;
    advance({ forceSong: true });
  }
}

async function advance({ forceSong = false } = {}) {
  if (transitioning) return;
  transitioning = true;

  if (activeType === 'song' && widget) widget.pause();
  if (activeType === 'ad') els.ad.pause();

  const shouldPlayAd = !forceSong && ads.length > 0 && tracksUntilAd <= 0;
  transitioning = false;

  if (shouldPlayAd) {
    tracksUntilAd = randomInt(CONFIG.songsBetweenAdsMin, CONFIG.songsBetweenAdsMax);
    return playAd(nextAd());
  }

  tracksUntilAd -= 1;
  return playSong(nextSong());
}

function updateProgress(positionMs, durationMs) {
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  const pct = duration > 0 ? Math.min(100, (positionMs / duration) * 100) : 0;
  els.progress.style.width = `${pct}%`;
  els.elapsed.textContent = formatTime(positionMs);
  els.duration.textContent = duration > 0 ? formatTime(duration) : '--:--';
}

function setMediaMetadata(title, artist, album) {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album,
    artwork: [{ src: './assets/icon.svg', sizes: '512x512', type: 'image/svg+xml' }],
  });
  navigator.mediaSession.playbackState = 'playing';
}

async function togglePlayback() {
  if (els.play.disabled || transitioning) return;
  els.play.disabled = true;

  try {
    if (!activeItem) {
      await advance({ forceSong: true });
      return;
    }

    if (playing) {
      if (activeType === 'song' && widget) widget.pause();
      if (activeType === 'ad') els.ad.pause();
      setPlayingUI(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } else {
      if (activeType === 'song') {
        await initializeWidget();
        widget.play();
      } else {
        await els.ad.play();
      }
      setPlayingUI(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
  } catch (error) {
    showError(error);
  } finally {
    els.play.disabled = false;
  }
}

els.play.addEventListener('click', togglePlayback);
els.skip.addEventListener('click', async () => {
  if (transitioning) return;
  await advance({ forceSong: activeType === 'ad' });
});
els.volume.addEventListener('input', () => {
  const value = Number(els.volume.value);
  if (widget) widget.setVolume(value);
  els.ad.volume = value / 100;
});

if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', togglePlayback);
    navigator.mediaSession.setActionHandler('pause', togglePlayback);
    navigator.mediaSession.setActionHandler('nexttrack', () => advance());
  } catch (error) {
    console.debug('Media Session controls partially unsupported.', error);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}

boot();
