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

// Control room: routes open locally (authenticated human out of V1 scope)
@ApiTags('screen')
@Controller('api')
export class ScreenController {
  constructor(private readonly screen: ScreenService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Alerts, most recent first' })
  @ApiOkResponse({ standardSchema: AlertList })
  listAlerts(@Query({ schema: AlertListQuery }) query: AlertListQuery) {
    return this.screen.listAlerts(query);
  }

  @Get('alerts/:id')
  @ApiOperation({
    summary: 'Alert, truck, investigation (all attempts) and review',
  })
  @ApiOkResponse({ standardSchema: AlertDetail })
  @ApiNotFoundResponse({ description: 'Alert not found' })
  alertDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.screen.alertDetail(id);
  }

  @Post('alerts/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Human review: confirm or dismiss the verdict' })
  @ApiOkResponse({ standardSchema: ReviewResult })
  @ApiNotFoundResponse({ description: 'Alert not found' })
  @ApiConflictResponse({
    description: 'Alert neither escalated nor closed, or already reviewed',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: ReviewRequest }) request: ReviewRequest,
  ) {
    return this.screen.review(id, request);
  }

  @Get('trucks/:id/tank-curve')
  @ApiOperation({ summary: 'Full tank curve (chart)' })
  @ApiOkResponse({ standardSchema: TankCurvePoints })
  @ApiNotFoundResponse({ description: 'Truck not found' })
  tankCurve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: ScreenWindowQuery }) query: ScreenWindowQuery,
  ) {
    return this.screen.tankCurve(id, toWindow(query));
  }

  @Get('trucks/:id/positions')
  @ApiOperation({ summary: 'Positions (mini-map)' })
  @ApiOkResponse({ standardSchema: Positions })
  @ApiNotFoundResponse({ description: 'Truck not found' })
  positions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: ScreenWindowQuery }) query: ScreenWindowQuery,
  ) {
    return this.screen.positions(id, toWindow(query));
  }

  @Get('places')
  @ApiOperation({ summary: 'Places (map)' })
  @ApiOkResponse({ standardSchema: PlaceList })
  places() {
    return this.screen.places();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistics and value delivered by the agents' })
  @ApiOkResponse({ standardSchema: Stats })
  stats() {
    return this.screen.stats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Service and database health' })
  @ApiOkResponse({ standardSchema: Health })
  health() {
    return this.screen.health();
  }
}
