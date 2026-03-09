step 4: done');
    res.json({ playlistUrl: playlistRes.data.external_urls.spotify });
  } catch (e) {
    console.error('create-playlist error:', e.response?.status, JSON.stringify(e.response?.data));
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// Client Credentials token cache
let clientToken = null;
let clientTokenExpiry = 0;

async function getClientToken() {
  if (clientToken && Date.now() < clientTokenExpiry) return clientToken;
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  clientToken = response.data.access_token;
  clientTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return clientToken;
}

app.get('/spotify/search', async (req, res) => {
  const { title, artist } = req.query;
  if (!title) return res.status(400).json({ error: 'Missing title' });
  try {
    const token = await getClientToken();
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
