import "dotenv/config";
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/hint", async (req, res) => {
  try {
    const { problemTitle, problemDescription } = req.body;

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content:
            "You are a DSA mentor. Give a short hint. Never give code or the full solution.",
        },
        {
          role: "user",
          content: `Problem: ${problemTitle}\n${problemDescription}`,
        },
      ],
    });

    res.json({ hint: completion.choices[0].message.content });
  } catch (err) {
    console.error("HINT ERROR:", err.message);
    res.status(500).json({ error: "The mentor is unavailable right now." });
  }
});

app.listen(5000, () => console.log("API on http://localhost:5000"));