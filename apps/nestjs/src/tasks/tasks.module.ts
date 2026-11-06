import { Module } from '@nestjs/common';
import { TaskSweeperService } from './task-sweeper.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TaskSweeperService],
  exports: [TasksService],
})
export class TasksModule {}
