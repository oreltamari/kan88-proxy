const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();

const BASE = 'https://n-121-3.il.cdn-redge.media/livehls/oil/kancdn-live/live/radio/kan_88/live.livx';
const ACR_HOST   = 'identify-ap-southeast-1.acrcloud.com';
const ACR_KEY    = '4c79fbfade6ec7d8422b4e500b930829';
const ACR_SECRET = 'Pjo7jijXPwp1K9QP1GMU41FqdrWNJH3rDAfoUYdH';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
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

app.listen(3000, () => console.log('Proxy running on http://localhost:3000'));
