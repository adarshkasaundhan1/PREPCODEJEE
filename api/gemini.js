export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, imageParts } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key is not configured on the server.' });
  }

  try {
    // Construct the parts array with text, and append image if it exists
    let apiParts = [{ text: prompt }];
    if (imageParts && imageParts.length > 0) {
      apiParts = apiParts.concat(imageParts);
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: apiParts }]
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates.length > 0) {
      const reply = data.candidates[0].content.parts[0].text;
      return res.status(200).json({ reply });
    } else {
      return res.status(500).json({ error: 'Gemini returned an empty response.' });
    }
  } catch (error) {
    console.error("Server API Error:", error);
    return res.status(500).json({ error: 'Failed to communicate with AI server.' });
  }
}
