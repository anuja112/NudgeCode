import "dotenv/config";
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const { GROQ_API_KEY, PORT = 5000 } = process.env;

if (!GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY. Add it to backend/.env");
  process.exit(1);
}

const app = express();
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || origin.startsWith("chrome-extension://")),
  })
);
app.use(express.json({ limit: "100kb" }));

const groq = new Groq({ apiKey: GROQ_API_KEY });

// ---------- hint ladder ----------
const LEVELS = {
  1: { name: "Nudge", guide: "Intuition only. Write 2-3 short guiding QUESTIONS about what the problem really asks. Do not describe any method." },
  2: { name: "Direction", guide: "Give ONE key observation about the problem's structure and why it helps. Do NOT describe a method or steps." },
  3: { name: "Blueprint", guide: "Give at most 3 ordered steps in plain English plus ONE edge case. No code, no named technique." },
};

const SYSTEM_PROMPT = `You are NudgeCode, a patient DSA mentor.

STRICT RULES:
- Never write code. Never give the full solution.
- Never name the algorithm or data structure that solves it.
- Never state time or space complexity.

OUTPUT FORMAT (exactly, nothing else):
KEY: <one sentence, max 20 words>
- <bullet, max 20 words>
- <bullet, max 20 words>
- <bullet, max 20 words>

Wrap the 1-3 most important words of each bullet in **double asterisks**.
If the student shared their approach, say what is right about it first, then gently point out flaws without fixing them.`;

function parseHint(raw = "") {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let key = "";
  const points = [];
  for (const line of lines) {
    if (/^key\s*:/i.test(line)) key = line.replace(/^key\s*:\s*/i, "");
    else points.push(line.replace(/^\s*(?:[-•*]\s+|\d+[.)]\s+)/, ""));
  }
  if (!key && points.length) key = points.shift();
  return { key, points: points.slice(0, 3) };
}


const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) {
    return res.status(429).json({ error: "Slow down - try again in a minute." });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}


const PREFERRED = [
  process.env.MODEL,
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
].filter(Boolean);

let MODEL = null;
async function pickModel() {
  const { data } = await groq.models.list();
  const ids = data.map((m) => m.id);
  MODEL =
    PREFERRED.find((id) => ids.includes(id)) ||
    ids.find((id) => !/whisper|guard|safeguard|tts|orpheus|embed|allam/i.test(id));
  if (!MODEL) throw new Error("No chat model available.");
  console.log(`Using model: ${MODEL}`);
}

// ---------- routes ----------
app.get("/health", (req, res) => res.json({ ok: true, model: MODEL }));

app.post("/api/hint", rateLimit, async (req, res) => {
  try {
    const {
      problemTitle,
      problemDescription,
      difficulty = "Unknown",
      userApproach = "",
      previousHints = [],
    } = req.body;

    if (!problemTitle || !problemDescription) {
      return res.status(400).json({ error: "Missing problem title or description." });
    }

    const level = Math.min(3, Math.max(1, Number(req.body.hintLevel) || 1));
    const prior = Array.isArray(previousHints) ? previousHints.slice(0, 2).map(String) : [];

    const userPrompt = [
      `Problem: ${String(problemTitle).slice(0, 200)} (${String(difficulty).slice(0, 20)})`,
      `Description:\n${String(problemDescription).slice(0, 4000)}`,
      prior.length ? `Hints already given (do not repeat them):\n${prior.join("\n---\n")}` : "",
      String(userApproach).trim()
        ? `Student's current approach:\n${String(userApproach).slice(0, 800)}`
        : "",
      `Hint level ${level} (${LEVELS[level].name}): ${LEVELS[level].guide}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!MODEL) await pickModel();

    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 1500,
      // gpt-oss models "think" first; keep that short so tokens go to the answer
      ...(MODEL.startsWith("openai/gpt-oss") && { reasoning_effort: "low" }),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content || "";
    const { key, points } = parseHint(raw);

    if (!key || points.length === 0) {
      console.error("BAD MODEL OUTPUT:", JSON.stringify(raw));
      return res.status(502).json({ error: "Unreadable answer. Click Regenerate." });
    }

    res.json({ hintLevel: level, key, points });
  } catch (err) {
    console.error("HINT ERROR:", err.message);
    if (err.status === 404) MODEL = null; // model vanished, re-pick next request
    res.status(500).json({ error: "The mentor is unavailable right now." });
  }
});

app.listen(PORT, async () => {
  console.log(`API on http://localhost:${PORT}`);
  try {
    await pickModel();
  } catch (err) {
    console.error("Could not list models yet:", err.message);
  }
});