// CLI du simulateur (spec 04) : generate | load | replay | reset.

import { parseArgs } from 'node:util';
import { ApiClient, configFromEnv } from './api.ts';
import { DEFAULT_DATA_DIR, readActivity, readGroundTruth, writeFiles } from './files.ts';
import { generate, serialize } from './generate.ts';
import { load } from './load.ts';
import { replay } from './replay.ts';
import { reset } from './reset.ts';
import { assertDate, localHHMM, localToUtcMs, parseHHMM, todayInParis } from './time.ts';

const USAGE = `Usage : simulator <commande> [options]

  generate [--seed 42] [--today AAAA-MM-JJ]         simule [aujourd'hui − 1 mois ; aujourd'hui] (heure de Paris)
                                                    et écrit les fichiers dans data/generated/
  load                                              envoie référentiel + historique (POST /admin/history/load)
  replay [--speed 120] [--from 00:00] [--to 23:55]  rejoue la journée de démo (dernier jour généré)
  reset                                             remet la journée de démo à zéro (POST /admin/reset)

Options communes : --data-dir <dossier>
Environnement : API_URL (http://localhost:3000), DEVICE_TOKEN, ADMIN_TOKEN, SIM_SEED`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      seed: { type: 'string', default: process.env.SIM_SEED ?? '42' },
      today: { type: 'string' },
      speed: { type: 'string', default: '120' },
      from: { type: 'string', default: '00:00' },
      to: { type: 'string', default: '23:55' },
      'data-dir': { type: 'string', default: DEFAULT_DATA_DIR },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command] = positionals;
  const dataDir = values['data-dir'];
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'generate': {
      const seed = Number(values.seed);
      if (!Number.isInteger(seed)) throw new Error(`--seed invalide : ${values.seed}`);
      const today = assertDate(values.today ?? todayInParis());
      const dataset = generate(seed, today);
      await writeFiles(dataDir, serialize(dataset));
      const cal = dataset.calendar;
      console.log(`Graine ${seed}, du ${cal.startDate} au ${cal.demoDate} (${cal.days} jours, heure de Paris) → ${dataDir}`);
      for (const [label, data] of [
        [`historique (${cal.startDate} → ${cal.date(cal.liveDay - 1)})`, dataset.history],
        [`journée de démo (${cal.demoDate})`, dataset.live],
      ] as const) {
        console.log(`  ${label} : ${data.telemetry.length} relevés, ${data.refuels.length} pleins, ${data.messages.length} messages`);
      }
      for (const s of dataset.groundTruth.scenarios) {
        console.log(`  ${s.id.padEnd(13)} ${s.truck} ${s.plate} ${s.localTime}  ${s.place.name}`);
      }
      return 0;
    }
    case 'load': {
      const api = new ApiClient(configFromEnv());
      console.log(`Chargement de ${dataDir} vers ${api.config.apiUrl}`);
      const inserted = await load(api, dataDir);
      console.log('Insérés :', inserted);
      return 0;
    }
    case 'reset': {
      const api = new ApiClient(configFromEnv());
      const { deleted } = await reset(api);
      console.log('Journée de démo remise à zéro. Supprimés :', deleted);
      return 0;
    }
    case 'replay': {
      const speed = Number(values.speed);
      if (!(speed > 0)) throw new Error(`--speed invalide : ${values.speed}`);
      const { demoDay } = await readGroundTruth(dataDir);
      const from = localToUtcMs(demoDay, parseHHMM(values.from));
      const to = localToUtcMs(demoDay, parseHHMM(values.to));
      const api = new ApiClient(configFromEnv());
      const live = await readActivity(dataDir, 'live');

      const controller = new AbortController();
      process.on('SIGINT', () => {
        if (controller.signal.aborted) process.exit(130);
        controller.abort();
        console.log('\nArrêt demandé : fin du pas en cours… (Ctrl-C à nouveau pour forcer)');
      });

      console.log(
        `Rejeu du ${demoDay} de ${values.from} à ${values.to} (heure de Paris), vitesse ×${speed} (un pas de 5 min = ${(300 / speed).toFixed(1)} s) → ${api.config.apiUrl}`,
      );
      const result = await replay(api, live, { from, to, speed, signal: controller.signal });
      if (result.completed) {
        console.log(`Rejeu terminé : ${result.alertsCreated} alerte(s) créée(s).`);
      } else {
        const resume = result.lastClock === null ? values.from : localHHMM(result.lastClock);
        console.log(`Rejeu interrompu (${result.alertsCreated} alerte(s) créée(s)). Reprendre avec : --from ${resume}`);
      }
      return 0;
    }
    default:
      console.error(`Commande inconnue : ${command}\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
