import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TasksService } from './tasks.service.js';

// Balayage périodique de la file (30 s par défaut), sans dépendance de planification
@Injectable()
export class TaskSweeperService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TaskSweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly tasks: TasksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    const interval = this.config.TASK_SWEEP_INTERVAL_MS;
    if (interval === 0) return;
    this.timer = setInterval(() => void this.run(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async run() {
    try {
      const failed = await this.tasks.sweep();
      if (failed > 0) this.logger.warn(`${failed} tâche(s) en échec définitif`);
    } catch (error) {
      this.logger.error('Balayage de la file en erreur', error as Error);
    }
  }
}
