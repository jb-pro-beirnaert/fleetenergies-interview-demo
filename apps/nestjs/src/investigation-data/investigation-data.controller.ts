import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  DriverMessages,
  FuelBalance,
  FuelTransactions,
  SimilarEvents,
  SimilarEventsQuery,
  TankCurve,
  TimeWindowQuery,
  TruckProfile,
  VehicleActivity,
} from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { PiiInterceptor } from '../pii/pii.interceptor.js';
import {
  InvestigationDataService,
  type Window,
} from './investigation-data.service.js';

const toWindow = (query: TimeWindowQuery): Window => ({
  from: new Date(query.from),
  to: new Date(query.to),
});

// Routes adaptées 1 pour 1 par le serveur MCP (un outil = une route)
@ApiTags('agent · outils')
@RequireToken('agent')
@UseInterceptors(PiiInterceptor)
@ApiBadRequestResponse({
  description: 'Paramètres invalides (fenêtre maximale 72 h)',
})
@ApiNotFoundResponse({ description: 'Camion introuvable ou aucun relevé' })
@Controller('agent/trucks/:truckId')
export class InvestigationDataController {
  constructor(private readonly data: InvestigationDataService) {}

  @Get('profile')
  @ApiOperation({ summary: 'get_truck_profile' })
  @ApiOkResponse({ standardSchema: TruckProfile })
  profile(@Param('truckId', ParseUUIDPipe) truckId: string) {
    return this.data.profile(truckId);
  }

  @Get('tank-curve')
  @ApiOperation({ summary: 'get_tank_curve' })
  @ApiOkResponse({ standardSchema: TankCurve })
  tankCurve(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: TimeWindowQuery }) query: TimeWindowQuery,
  ) {
    return this.data.tankCurve(truckId, toWindow(query));
  }

  @Get('activity')
  @ApiOperation({ summary: 'get_vehicle_activity' })
  @ApiOkResponse({ standardSchema: VehicleActivity })
  activity(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: TimeWindowQuery }) query: TimeWindowQuery,
  ) {
    return this.data.activity(truckId, toWindow(query));
  }

  @Get('fuel-transactions')
  @ApiOperation({ summary: 'find_fuel_transactions' })
  @ApiOkResponse({ standardSchema: FuelTransactions })
  fuelTransactions(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: TimeWindowQuery }) query: TimeWindowQuery,
  ) {
    return this.data.fuelTransactions(truckId, toWindow(query));
  }

  @Get('driver-messages')
  @ApiOperation({ summary: 'read_driver_messages' })
  @ApiOkResponse({ standardSchema: DriverMessages })
  driverMessages(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: TimeWindowQuery }) query: TimeWindowQuery,
  ) {
    return this.data.driverMessages(truckId, toWindow(query));
  }

  @Get('fuel-balance')
  @ApiOperation({ summary: 'compute_fuel_balance' })
  @ApiOkResponse({ standardSchema: FuelBalance })
  fuelBalance(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: TimeWindowQuery }) query: TimeWindowQuery,
  ) {
    return this.data.fuelBalance(truckId, toWindow(query));
  }

  @Get('similar-events')
  @ApiOperation({ summary: 'find_similar_events' })
  @ApiOkResponse({ standardSchema: SimilarEvents })
  similarEvents(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query({ schema: SimilarEventsQuery }) query: SimilarEventsQuery,
  ) {
    return this.data.similarEvents(truckId, query.lookbackDays);
  }
}
