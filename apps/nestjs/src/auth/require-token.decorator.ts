import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TOKEN_ROLE, TokenGuard, type TokenRole } from './token.guard.js';

// Protects a controller or a route with a role token and documents it in OpenAPI
export function RequireToken(role: TokenRole) {
  return applyDecorators(
    SetMetadata(TOKEN_ROLE, role),
    UseGuards(TokenGuard),
    ApiBearerAuth(role),
    ApiUnauthorizedResponse({ description: 'Missing or invalid token' }),
    ApiForbiddenResponse({ description: 'Token of another role' }),
  );
}
