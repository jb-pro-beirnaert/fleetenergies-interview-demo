import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AlertDetail,
  AlertList,
  AlertListQuery,
  Health,
  PlaceList,
  Positions,
  ReviewRequest,
  ReviewResult,
  ScreenWindowQuery,
  Stats,
  TankCurvePoints,
} from '@fleet/contracts';
import { ScreenService } from './screen.service.js';

const toWindow = (query: ScreenWindowQuery) => ({
  from: new Date(query.from),
  to: new Date(query.to),
});

// Salle de contrôle : routes ouvertes en local (humain authentifié hors périmètre V1)
@ApiTags('écran')
@Controller('api')
export class ScreenController {
  constructor(private readonly screen: ScreenService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Alertes, les plus récentes en premier' })
  @ApiOkResponse({ standardSchema: AlertList })
  listAlerts(@Query({ schema: AlertListQuery }) query: AlertListQuery) {
    return this.screen.listAlerts(query);
  }

  @Get('alerts/:id')
  @ApiOperation({
    summary: 'Alerte, camion, enquête (toutes tentatives) et revue',
  })
  @ApiOkResponse({ standardSchema: AlertDetail })
  @ApiNotFoundResponse({ description: 'Alerte introuvable' })
  alertDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.screen.alertDetail(id);
  }

  @Post('alerts/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revue humaine : confirmer ou rejeter le verdict' })
  @ApiOkResponse({ standardSchema: ReviewResult })
  @ApiNotFoundResponse({ description: 'Alerte introuvable' })
  @ApiConflictResponse({
    description: 'Alerte ni escaladée ni close, ou déjà revue',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: ReviewRequest }) request: ReviewRequest,
  ) {
    return this.screen.review(id, request);
  }

  @Get('trucks/:id/tank-curve')
  @ApiOperation({ summary: 'Courbe complète du réservoir (graphique)' })
  @ApiOkResponse({ standardSchema: TankCurvePoints })
  @ApiNotFoundResponse({ description: 'Camion introuvable' })
  tankCurve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: ScreenWindowQuery }) query: ScreenWindowQuery,
  ) {
    return this.screen.tankCurve(id, toWindow(query));
  }

  @Get('trucks/:id/positions')
  @ApiOperation({ summary: 'Positions (mini-carte)' })
  @ApiOkResponse({ standardSchema: Positions })
  @ApiNotFoundResponse({ description: 'Camion introuvable' })
  positions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: ScreenWindowQuery }) query: ScreenWindowQuery,
  ) {
    return this.screen.positions(id, toWindow(query));
  }

  @Get('places')
  @ApiOperation({ summary: 'Lieux (carte)' })
  @ApiOkResponse({ standardSchema: PlaceList })
  places() {
    return this.screen.places();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques et valeur apportée par les agents' })
  @ApiOkResponse({ standardSchema: Stats })
  stats() {
    return this.screen.stats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Santé du service et de la base' })
  @ApiOkResponse({ standardSchema: Health })
  health() {
    return this.screen.health();
  }
}
