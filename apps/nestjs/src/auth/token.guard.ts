import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export type TokenRole = 'device' | 'agent' | 'admin';
export const TOKEN_ROLE = 'fleet:token-role';

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Static Bearer tokens: wrong token → 401, token of another role → 403
@Injectable()
export class TokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TokenRole | undefined>(
      TOKEN_ROLE,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const role = token ? this.roleOf(token) : undefined;

    if (!role) throw new UnauthorizedException('Missing or invalid token');
    if (role !== required) {
      throw new ForbiddenException(`Token "${role}" not allowed here`);
    }
    return true;
  }

  private roleOf(token: string): TokenRole | undefined {
    const tokens: Record<TokenRole, string> = {
      device: this.config.DEVICE_TOKEN,
      agent: this.config.AGENT_API_TOKEN,
      admin: this.config.ADMIN_TOKEN,
    };
    return (Object.keys(tokens) as TokenRole[]).find((role) =>
      sameToken(token, tokens[role]),
    );
  }
}
