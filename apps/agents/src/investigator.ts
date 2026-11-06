// Squelette : la boucle de l'agent enquêteur arrive au jalon M5 (spec 06)
console.log(
  JSON.stringify({
    msg: 'investigator started',
    apiUrl: process.env.API_URL,
    mcpUrl: process.env.MCP_URL,
    llmBaseUrl: process.env.LLM_BASE_URL,
  }),
);

// Garde le processus en vie jusqu'à l'arrêt du conteneur
const keepAlive = setInterval(() => {}, 60_000);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive);
    console.log(JSON.stringify({ msg: 'investigator stopped', signal }));
    process.exit(0);
  });
}
