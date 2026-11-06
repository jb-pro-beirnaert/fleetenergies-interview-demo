// Proxy de `ng serve` (localhost hors Docker, services Compose sinon) :
// /api -> NestJS, /simulation -> API de contrôle du simulateur
export default {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: true,
  },
  '/simulation': {
    target: process.env.SIMULATION_PROXY_TARGET ?? 'http://localhost:3200',
    changeOrigin: true,
  },
};
