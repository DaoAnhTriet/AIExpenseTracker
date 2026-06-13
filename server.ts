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

// Heuristic parser as absolute fallback if Gemini API is disabled, blocked or denied (403)
function parseHeuristically(text: string, totalBalance: number) {
  const norm = text.toLowerCase().trim();
  
  // 1. Determine type
  const incomeKeywords = [
    "nhận lương", "được cho", "nhặt được", "bán đồ", "có lương", "cộng tiền", 
    "nhận chuyển khoản", "thu nhập", "lương", "được lì xì", "được tặng", 
    "bán được", "thưởng", "lài", "đòi nợ", "ting ting"
  ];
  let type: "expense" | "income" = "expense";
  for (const kw of incomeKeywords) {
    if (norm.includes(kw)) {
      type = "income";
      break;
    }
  }

  // 2. Determine category
  let category = "Khác";
  if (type === "income") {
    category = "Thu nhập";
  }

  const categoryMap = [
    {
      cat: "Ăn uống",
      keywords: ["ăn", "uống", "cơm", "phở", "bún", "bánh mì", "trà sữa", "cafe", "cà phê", "nước", "lẩu", "buffet", "snack", "kẹo", "kem", "nhậu", "bia", "rượu", "tạp hóa", "thịt", "rau", "bữa", "bánh", "bún chả", "nem", "xôi", "mì tôm"]
    },
    {
      cat: "Di chuyển",
      keywords: ["xe", "grab", "be", "gojek", "taxi", "xăng", "vận chuyển", "vé máy bay", "tàu hỏa", "bus", "xe buýt", "gửi xe", "phí xe", "lốp", "bảo dưỡng"]
    },
    {
      cat: "Mua sắm",
      keywords: ["mua", "áo", "quần", "giày", "sách", "shopee", "lazada", "tiki", "order", "mỹ phẩm", "son", "váy", "túi", "đồng hồ", "điện thoại", "tai nghe"]
    },
    {
      cat: "Nhà ở & Hóa đơn",
      keywords: ["nhà", "phòng", "điện", "nước", "wifi", "mạng", "internet", "hóa đơn", "bill", "chuyển khoản nhà", "rác", "dịch vụ", "thuê nhà"]
    },
    {
      cat: "Học tập",
      keywords: ["học", "trường học", "khóa học", "sách vở", "bút", "học phí", "tài liệu", "tiếng anh", "sem", "thi", "lớp"]
    },
    {
      cat: "Giải trí",
      keywords: ["chơi", "game", "netflix", "spotify", "phim", "cgv", "rạp", "karaoke", "du lịch", "phượt", "camping", "thể thao", "gym", "bóng đá", "bách hóa", "rap", "hát", "đi đu đưa"]
    },
    {
      cat: "Sức khỏe",
      keywords: ["thuốc", "bệnh viện", "phòng khám", "bác sĩ", "spa", "skincare", "kem chống nắng", "nước hoa", "cắt tóc", "nail", "nha khoa", "răng", "vitamin", "thuốc cảm"]
    }
  ];

  for (const mapping of categoryMap) {
    for (const kw of mapping.keywords) {
      if (norm.includes(kw)) {
        category = mapping.cat;
        break;
      }
    }
  }

  // 3. Determine amount
  let amount = 0;
  if (norm.includes("tờ xanh") || norm.includes("tờ 5 lít") || norm.includes("tờ 500k") || norm.includes("tờ 500 cành")) {
    amount = 500000;
  } else if (norm.includes("tờ quả dưa") || norm.includes("tờ 2 lít") || norm.includes("tờ 200k") || norm.includes("tờ 2 cành to")) {
    amount = 200000;
  } else {
    const rx = /(\d+(?:[\.,]\d+)?)\s*(k|ngàn|nghìn|cành|lá|mực|lít|loét|xị|củ|mực\s+to|triệu|tr|chục|đ|đồng|vnd|bánh)?/gi;
    let match;
    const foundAmounts: number[] = [];

    while ((match = rx.exec(norm)) !== null) {
      const numStr = match[1];
      const unit = match[2];
      const num = parseFloat(numStr.replace(",", "."));
      if (!isNaN(num)) {
        let converted = num;
        const u = unit ? unit.trim().toLowerCase() : "";
        if (u === "k" || u === "ngàn" || u === "nghìn" || u === "cành" || u === "lá") {
          converted = num * 1000;
        } else if (u === "chục") {
          converted = num * 10000;
        } else if (u === "mực" || u === "lít" || u === "loét" || u === "xị") {
          converted = num * 100000;
        } else if (u === "củ" || u === "mực to" || u === "triệu" || u === "tr") {
          converted = num * 1000000;
        } else if (u === "bánh") {
          converted = num * 1000000000;
        } else if (!u) {
          if (num < 1000) {
            converted = num * 1000;
          }
        }
        foundAmounts.push(converted);
      }
    }

    if (foundAmounts.length > 0) {
      amount = foundAmounts.reduce((a, b) => a + b, 0);
    } else {
      amount = 50000;
    }
  }

  // 4. Generate cleanest note
  let note = text;
  note = note.replace(/\d+(?:\.[\d]+)?\s*(k|ngàn|nghìn|cành|lá|mực|lít|loét|xị|củ|mực\s+to|triệu|tr|chục|đ|đồng|vnd|bánh)?/gi, "");
  note = note.replace(/(hết|cho|được|bị|mất|trả|tiền|thanh\s+toán|vừa|mới|đi|mua|nhận)/gi, "");
  note = note.trim();
  note = note.replace(/^[-–:,\s]+|[-–:,\s]+$/g, "").trim();
  if (!note) {
    note = text;
  }
  note = note.charAt(0).toUpperCase() + note.slice(1);

  // 5. Replies
  let reply = "Bộ não Heuristic thông minh đã lưu vết thành công nghe ní!";
  const amountStr = amount.toLocaleString("vi-VN");

  if (type === "income") {
    const replies = [
      `U là trời phú bà/phú ông ghé chơi! Bao nuôi em đi chủ tịch 💸 Nhận được tận ${amountStr} VND lận!`,
      `Tiền về ting ting nghe dui cái nách hà! Phát card đi chủ tịch 🤑`,
      `Xuất sắc ní ơi! Có thêm ${amountStr} VND dắt bét phờ ren tài chính này đi cafe điii 😘`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  } else {
    if (category === "Ăn uống") {
      const replies = [
        `Lại ăn uống nữa hả ní? Ví tiền đang kêu ét ô ét khóc thút thít kìa, béo nú nần rùi nha 🥤🍔`,
        `Ăn uống là niềm đau nhưng khum ăn thì thèm chầm kẽm luôn á! Thôi ăn nốt lần này rùi nhịn nha...`,
        `Ăn một bữa bay ngay ${amountStr} VND. Kiểu này cuối tháng húp mì tôm tẹt ga rồi!`
      ];
      reply = replies[Math.floor(Math.random() * replies.length)];
    } else if (category === "Mua sắm") {
      const replies = [
        `Chốt đơn râm ran Shopee/TikTok Shop là mụt thói quen khó bỏ đúng khum? Ví khóc thét rùi á 🛍️`,
        `Shopping xả stress rùi tới lúc đóng tiền điện nước lại stress tiếp đó ní. Tém tém lại giùm nha!`
      ];
      reply = replies[Math.floor(Math.random() * replies.length)];
    } else if (category === "Giải trí") {
      const replies = [
        `Đi đu đưa đi vui vẻ khum quạu nha! Chi hẳn ${amountStr} VND thế này thì ví xơ xác rùi.`,
        `Chơi hết mình thì lúc hết tiền cũng phải chịu đựng nha ní. Nhưng vui là được nè! 🎉`
      ];
      reply = replies[Math.floor(Math.random() * replies.length)];
    } else if (category === "Nhà ở & Hóa đơn") {
      reply = `Hóa đơn tới dồn dập cản khum kịp luôn. Thở thôi cũng mất ${amountStr} VND, cố lên nha ní ơi!`;
    } else if (category === "Di chuyển") {
      reply = `Xăng tăng hay xe ôm đắt đỏ mà tốn tận ${amountStr} VND vậy ní? Di chuyển an toàn nè! 🛵`;
    } else if (category === "Học tập") {
      reply = `Đầu tư cho trí tuệ hết ${amountStr} VND là khoản đầu tư hời nhất quả đất rồi ní ơi! Đỉnh chóp luv luv 📚`;
    } else if (category === "Sức khỏe") {
      reply = `Tiêu ${amountStr} VND chăm sóc bản thân là hoàn toàn xứng đáng. Có sức khỏe mới gồng gánh ví được nè! 💪`;
    } else {
      reply = `Heuristic ghi nhận khoản chi ${amountStr} VND cho mục ${category}. Tiêu pha có kế hoạch vô nha ní!`;
    }
  }

  return {
    amount,
    category,
    note,
    type,
    reply
  };
}

// API routes
app.post("/api/expense/parse", async (req, res) => {
  try {
    const { text, totalBalance, currency = "VND" } = req.body;
    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required to parse expense." });
    }

    const modelChain = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
    let lastError: any = null;
    let parsedData: any = null;

    for (const modelName of modelChain) {
      try {
        console.log(`[Parser] Attempting parsing transaction with model: ${modelName}`);
        const ai = getGeminiClient();
        const promptText = `
User entered: "${text}"
Current total balance: ${totalBalance || 0} ${currency}
Parse this transaction and generate a witty Gen Z response about it. Return standard JSON.
`;

        const response = await ai.models.generateContent({
          model: modelName,
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

        const responseText = response.text?.trim() || "{}";
        parsedData = JSON.parse(responseText);
        console.log(`[Parser] Successful parse with model: ${modelName}`);
        break;
      } catch (err: any) {
        console.warn(`[Parser] Mode ${modelName} failed:`, err.message || err);
        lastError = err;
        if (err.message?.includes("GEMINI_API_KEY")) {
          break;
        }
      }
    }

    if (!parsedData) {
      console.log("[Parser] All models failed. Triggering Smart Vietnamese Heuristic Parser & Gen Z offline backup...");
      const isDenied = lastError && (
        lastError.message?.includes("403") || 
        lastError.message?.includes("PERMISSION_DENIED") || 
        lastError.message?.includes("denied access")
      );
      const isKeyMissing = lastError && lastError.message?.includes("GEMINI_API_KEY");

      parsedData = parseHeuristically(text, totalBalance);

      if (isKeyMissing) {
        parsedData.reply = `⚠️ [AI Offline - Chưa cài đặt API Key] ${parsedData.reply}`;
      } else if (isDenied) {
        parsedData.reply = `⚠️ [AI Offline - Khóa API bị chặn 403] Bét-Phờ-Ren Tài Chính đang tạm xử lý bằng bộ định vị Heuristic cục bộ cực vip vì khóa kết nối Google Cloud của dự án ní vừa bị chặn (403 PERMISSION_DENIED). Ní check lại Settings nhé! Còn giờ cứ nhập vô tư, tui tự phân loại mượt hết! ${parsedData.reply}`;
      } else {
        parsedData.reply = `⚠️ [AI Offline - Sự cố kết nối] Bét-Phờ-Ren tạm xử lý Heuristic: ${parsedData.reply}`;
      }
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error("Critical Parse Route Error:", error);
    res.status(500).json({ 
      error: error.message || "Failed to parse expense.",
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
