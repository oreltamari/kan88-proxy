const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();

const BASE = 'https://n-121-3.il.cdn-redge.media/livehls/oil/kancdn-live/live/radio/kan_88/live.livx';
const ACR_HOST   = 'identify-ap-southeast-1.acrcloud.com';
const ACR_KEY    = '4c79fbfade6ec7d8422b4e500b930829';
const ACR_SECRET = 'Pjo7jijXPwp1K9QP1GMU41FqdrWNJH3rDAfoUYdH';

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'https://kan88-proxy-production.up.railway.app/callback';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use('/stream', async (req, res) => {
  const url = `${BASE}${req.url}`;
  try {
    const response = await axios.get(url, { responseType: 'stream' });
    res.set('Content-Type', response.headers['content-type']);
    response.data.pipe(res);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

async function getStartTime() {
  const playlistUrl = `${BASE}/playlist.m3u8?bitrate=192000&audioId=1&lang=pol&renditions`;
  const res = await axios.get(playlistUrl);
  const match = res.data.match(/startTime=(\d+)/);
  return match ? match[1] : null;
}

app.get('/detect', async (req, res) => {
  try {
    const startTime = await getStartTime();
    if (!startTime) return res.status(500).json({ error: 'Could not get startTime' });
    const tsUrl = `${BASE}/fragment.ts?bitrate=192000&audioId=1&renditions&startTime=${startTime}`;
    const audioRes = await axios.get(tsUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const audioBuffer = Buffer.from(audioRes.data);
    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = `POST\n/v1/identify\n${ACR_KEY}\naudio\n1\n${timestamp}`;
    const signature = crypto.createHmac('sha1', ACR_SECRET).update(stringToSign).digest('base64');
    const form = new FormData();
    form.append('sample', audioBuffer, { filename: 'sample.ts', contentType: 'audio/mp2t' });
    form.append('access_key', ACR_KEY);
    form.append('data_type', 'audio');
    form.append('signature_version', '1');
    form.append('signature', signature);
    form.append('timestamp', timestamp);
    const acrRes = await axios.post(`https://${ACR_HOST}/v1/identify`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });
    res.json(acrRes.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/spotify/login', (req, res) => {
  const scopes = 'playlist-modify-public playlist-modify-private';
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    const { access_token } = response.data;
    res.redirect(`https://kan88proxy.vercel.app/?spotify_token=${access_token}`);
  } catch (e) {
    res.status(500).send('Spotify auth error: ' + e.message);
  }
});

app.post('/spotify/create-playlist', express.json(), async (req, res) => {
  const { token, trackIds, name } = req.body;
  try {
    const meRes = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = meRes.data.id;
    const playlistRes = await axios.post(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      { name: name || 'כאן 88 – היסטוריה', public: true },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const playlistId = playlistRes.data.id;
    const uris = trackIds.map(id => `spotify:track:${id}`);
    await axios.post(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      { uris },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    res.json({ playlistUrl: playlistRes.data.external_urls.spotify });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/spotify/search', async (req, res) => {
  const { token, title, artist } = req.query;
  if (!token || !title) return res.status(400).json({ error: 'Missing token or title' });
  try {
    const q = encodeURIComponent(`track:${title} artist:${artist || ''}`);
    const searchRes = await axios.get(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const track = searchRes.data.tracks?.items?.[0];
    if (track) {
      res.json({ id: track.id, name: track.name, artist: track.artists?.[0]?.name });
    } else {
      res.json({ id: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Proxy running'));
