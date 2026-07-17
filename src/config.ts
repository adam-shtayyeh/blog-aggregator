import fs from "fs";
import os from "os";
import path from "path";

// تعريف الواجهة البرمجية للإعدادات داخل الكود (CamelCase)
export interface Config {
  dbUrl: string;
  currentUserName?: string;
}

// دالة مساعدة للحصول على مسار الملف في الـ Home Directory (~/.gatorconfig.json)
function getConfigFilePath(): string {
  return path.join(os.homedir(), ".gatorconfig.json");
}

// دالة مساعدة للكتابة الفعالة داخل ملف الـ JSON بتحويل الحقول إلى snake_case
function writeConfig(cfg: Config): void {
  const filePath = getConfigFilePath();
  const rawData = {
    db_url: cfg.dbUrl,
    current_user_name: cfg.currentUserName,
  };
  fs.writeFileSync(filePath, JSON.stringify(rawData, null, 2), "utf-8");
}

// التحقق من صحة كائن الـ JSON المحمل وتحويله لـ Config
function validateConfig(rawConfig: any): Config {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Invalid config file format");
  }
  if (typeof rawConfig.db_url !== "string") {
    throw new Error("Missing or invalid 'db_url' in config file");
  }
  return {
    dbUrl: rawConfig.db_url,
    currentUserName: rawConfig.current_user_name,
  };
}

// 1. دالة قراءة الإعدادات
export function readConfig(): Config {
  const filePath = getConfigFilePath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found at ${filePath}`);
  }
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const rawConfig = JSON.parse(fileContent);
  return validateConfig(rawConfig);
}

// 2. دالة تعديل اسم المستخدم الحالي وحفظ الملف
export function setUser(username: string): void {
  const currentConfig = readConfig();
  currentConfig.currentUserName = username;
  writeConfig(currentConfig);
}
