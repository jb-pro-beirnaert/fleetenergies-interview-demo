// `ng serve` proxy (localhost outside Docker, Compose services otherwise):
// /api -> NestJS, /simulation -> simulator control API
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
