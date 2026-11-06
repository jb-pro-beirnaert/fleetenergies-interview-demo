import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TasksService } from './tasks.service.js';

// Periodic sweep of the queue (30 s by default), without a scheduling dependency
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
      if (failed > 0) this.logger.warn(`${failed} task(s) permanently failed`);
    } catch (error) {
      this.logger.error('Queue sweep failed', error as Error);
    }
  }
}
