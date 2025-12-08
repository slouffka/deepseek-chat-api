import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Enable CORS for all origins
app.use(express.json());

app.post('/api/deepseek-proxy', async (req, res) => {
    try {
        const response = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization // Forward the Authorization header
            },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
});
