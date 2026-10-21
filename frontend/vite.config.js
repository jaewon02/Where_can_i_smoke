import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173, proxy: { "/api": "http://localhost:8001" } },
  // 운영 미리보기(npm run preview)는 운영 백엔드(8000)로 프록시
  preview: { port: 4173, proxy: { "/api": "http://localhost:8000" } },
});
