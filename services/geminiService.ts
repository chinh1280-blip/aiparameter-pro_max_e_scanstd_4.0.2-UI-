import { GoogleGenAI } from "@google/genai";

/**
 * Hàm làm sạch Schema JSON trước khi gửi lên Gemini.
 * Gemini API sử dụng một tập con của OpenAPI 3.0.
 * LƯU Ý QUAN TRỌNG: 
 * 1. Không hỗ trợ từ khóa 'const'.
 * 2. Từ khóa 'enum' CHỈ được phép sử dụng cho kiểu STRING. 
 *    Sử dụng enum cho NUMBER hoặc INTEGER sẽ gây lỗi 400 INVALID_ARGUMENT.
 */
const sanitizeSchema = (schema: any): any => {
  if (typeof schema !== 'object' || schema === null) return schema;

  const newSchema = Array.isArray(schema) ? [...schema] : { ...schema };

  // Xử lý const: Gemini không hỗ trợ const
  if (Object.prototype.hasOwnProperty.call(newSchema, 'const')) {
    const constVal = newSchema.const;
    // Chỉ chuyển sang enum nếu là chuỗi, vì Gemini chỉ cho phép enum với STRING
    if (newSchema.type === 'string' || typeof constVal === 'string') {
      newSchema.enum = [constVal];
    }
    delete newSchema.const;
  }

  // Xử lý enum: Nếu type không phải string, Gemini không cho phép enum
  if (Object.prototype.hasOwnProperty.call(newSchema, 'enum')) {
    if (newSchema.type !== 'string' && typeof newSchema.enum[0] !== 'string') {
      delete newSchema.enum;
    }
  }

  // Đệ quy cho các thuộc tính con
  for (const key in newSchema) {
    if (typeof newSchema[key] === 'object' && newSchema[key] !== null) {
      newSchema[key] = sanitizeSchema(newSchema[key]);
    }
  }
  return newSchema;
};

export const analyzeImage = async (
  base64Image: string,
  prompt: string,
  schemaJson: string,
  modelName: string,
  apiKeyOverride?: string
): Promise<any> => {
  const activeKey = apiKeyOverride || process.env.API_KEY;
  
  if (!activeKey) {
    throw new Error("Chưa cấu hình API Key. Vui lòng kiểm tra cài đặt.");
  }

  const ai = new GoogleGenAI({ apiKey: activeKey });

  let schema;
  try {
    const rawSchema = typeof schemaJson === 'string' ? JSON.parse(schemaJson) : schemaJson;
    schema = sanitizeSchema(rawSchema);
  } catch (e) {
    throw new Error("Cấu trúc Schema JSON không hợp lệ.");
  }

  // Làm sạch chuỗi base64 (loại bỏ xuống dòng nếu có)
  const cleanBase64 = base64Image.replace(/\s/g, '');

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64,
              },
            },
            {
              text: "Extract parameters precisely based on the provided image and system instructions. Follow the response schema strictly.",
            },
          ],
        }
      ],
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI không phản hồi dữ liệu hoặc hình ảnh không rõ ràng.");

    return JSON.parse(text);
  } catch (error: any) {
    console.error(`Gemini API Error:`, error);
    if (error.message?.toLowerCase().includes("invalid argument")) {
      throw new Error("Lỗi cấu hình (400): Schema chứa thuộc tính không hợp lệ (ví dụ: enum cho kiểu số). Vui lòng kiểm tra lại JSON Schema.");
    }
    throw error;
  }
};