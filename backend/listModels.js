import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { data } = await groq.models.list();
data.forEach((m) => console.log(m.id));