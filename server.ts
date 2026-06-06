import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini Client
let aiInst: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiInst) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
      throw new Error("GEMINI_API_KEY is not configured. Please add it under Settings > Secrets.");
    }
    aiInst = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInst;
}

// System Instruction for Gemini to translate spoken/written text into expenses/incomes
const SYSTEM_INSTRUCTION = `
You are a highly-optimized Vietnamese financial parsing assistant and a witty, cynical Gen Z friend.
Your job is to read user input (which can be a transcription or short text in Vietnamese or English) and parse it into structured transaction data.

Understand the Vietnamese slang for financial amounts:
- "k", "ngàn", "nghìn" = x 1,000 (e.g., "50k" = 50000, "lăm mươi k" = 50000)
- "cành", "lá" = x 1,000 (e.g., "60 cành" = 60000)
- "mực", "lít", "loét", "xị" = x 100,000 (e.g., "1 lít" = 100000, "5 xị" = 500000)
- "củ", "mực to" = x 1,000,000 (e.g., "2 củ" = 2000000)
- "bánh" = x 1,000,000,000 or depending on context, usually 1,000,000 or x1000000. Wait, inside simple expenses we assume "bánh" = 1,000,000,000 or in some contexts. Let's assume standard VND conversion.
- "tờ quả dưa" = 200,000 VND.
- "tờ xanh" = 500,000 VND.

Categories should ONLY be one of the following:
- "Ăn uống" (Food & Drink)
- "Di chuyển" (Transport)
- "Mua sắm" (Shopping)
- "Nhà ở & Hóa đơn" (Rent, Housing & Bills)
- "Học tập" (Education)
- "Giải trí" (Entertainment & Sports)
- "Sức khỏe" (Health & Beauty)
- "Thu nhập" (Income - like salary, pocket money)
- "Khác" (Others)

Detect transaction type:
- "income": if they received money (nhận lương, được cho, nhặt được, bán đồ, có lương).
- "expense": default for all spending, buying, paying.

Generate a 'reply' in funny, witty, sarcastic Vietnamese Gen Z slang:
- If they spend on tea/coffee/bubble tea: tease them about "biểu tình ví", "béo", "tuổi trẻ chưa trải sự đời".
- If they spend a large amount of money: complain about poverty, offer to eat instant noodles (mì tôm) with them.
- If they receive money (income): praise them ("phú bà", "phú ông", "chủ tịch", "bao nuôi em với").
- Keep responses short, concise, and using modern Vietnamese keyboard slang (e.g., mụt, dị, khum, ét ô ét, dui, chầm kẽm, luv, rùi, hihi).
`;

// API routes
app.post("/api/expense/parse", async (req, res) => {
  try {
    const { text, totalBalance, currency = "VND" } = req.body;
    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required to parse expense." });
    }

    const ai = getGeminiClient();
    const promptText = `
User entered: "${text}"
Current total balance: ${totalBalance || 0} ${currency}
Parse this transaction and generate a witty Gen Z response about it. Return standard JSON.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            amount: { 
              type: Type.NUMBER, 
              description: "Parsed absolute transaction amount value in standard integer VND/currency (e.g. 50000 instead of 50 or 50k)." 
            },
            category: { 
              type: Type.STRING, 
              description: "One of the allowed categories: Ăn uống, Di chuyển, Mua sắm, Nhà ở & Hóa đơn, Học tập, Giải trí, Sức khỏe, Thu nhập, Khác." 
            },
            note: { 
              type: Type.STRING, 
              description: "Short literal description of the transaction in Vietnamese, capitalized nicely." 
            },
            type: { 
              type: Type.STRING, 
              description: "Must be 'expense' or 'income'." 
            },
            reply: { 
              type: Type.STRING, 
              description: "Vietnamese Gen Z witty humorous reply commenting on this spend or earn." 
            }
          },
          required: ["amount", "category", "note", "type", "reply"]
        }
      }
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Parse Error:", error);
    res.status(500).json({ 
      error: error.message || "Failed to parse expense via Gemini AI.",
      isConfigError: error.message?.includes("GEMINI_API_KEY")
    });
  }
});

// Serve health status
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware for dev mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Static production build files serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
