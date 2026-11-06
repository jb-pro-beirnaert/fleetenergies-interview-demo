import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TOKEN_ROLE, TokenGuard, type TokenRole } from './token.guard.js';

// Protège un contrôleur ou une route par un jeton de rôle et le documente dans OpenAPI
export function RequireToken(role: TokenRole) {
  return applyDecorators(
    SetMetadata(TOKEN_ROLE, role),
    UseGuards(TokenGuard),
    ApiBearerAuth(role),
    ApiUnauthorizedResponse({ description: 'Jeton manquant ou invalide' }),
    ApiForbiddenResponse({ description: "Jeton d'un autre rôle" }),
  );
}
