import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("缺少 Gemini API 密鑰");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const geminiProModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

/**
 * @param prompt
 * @returns
 */
export async function generateResponse(prompt: string): Promise<string> {
  try {
    const result = await geminiProModel.generateContent(prompt);
    const response = result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini API 錯誤:", error);
    throw new Error("生成回應時發生錯誤，請稍後再試");
  }
}
