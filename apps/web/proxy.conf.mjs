// Proxy de `ng serve` : /api -> NestJS (localhost hors Docker, service `nestjs` dans Compose)
export default {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: true,
  },
};
