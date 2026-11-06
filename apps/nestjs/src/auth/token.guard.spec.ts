import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '../config/config.js';
import { TokenGuard, type TokenRole } from './token.guard.js';

const config = {
  DEVICE_TOKEN: 'device-secret',
  AGENT_API_TOKEN: 'agent-secret',
  ADMIN_TOKEN: 'admin-secret',
} as AppConfig;

function contextWith(authorization?: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

function guardRequiring(role: TokenRole | undefined) {
  const reflector = { getAllAndOverride: () => role } as unknown as Reflector;
  return new TokenGuard(reflector, config);
}

describe('TokenGuard', () => {
  it('lets the right token through', () => {
    expect(
      guardRequiring('agent').canActivate(contextWith('Bearer agent-secret')),
    ).toBe(true);
  });

  it('401 without a token, with an unknown token or without "Bearer"', () => {
    const guard = guardRequiring('agent');
    expect(() => guard.canActivate(contextWith())).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith('Bearer nope'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith('agent-secret'))).toThrow(
      UnauthorizedException,
    );
  });

  it('403 with the token of another role', () => {
    expect(() =>
      guardRequiring('admin').canActivate(contextWith('Bearer device-secret')),
    ).toThrow(ForbiddenException);
  });

  it('route without a role: open', () => {
    expect(guardRequiring(undefined).canActivate(contextWith())).toBe(true);
  });
});
