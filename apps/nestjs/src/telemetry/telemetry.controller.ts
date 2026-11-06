import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  DriverMessageBatch,
  FuelCardBatch,
  IngestResult,
  TelemetryBatch,
  TelemetryIngestResult,
} from '@fleet/contracts';
import { RequireToken } from '../auth/require-token.decorator.js';
import { TelemetryService } from './telemetry.service.js';

@ApiTags('ingestion')
@RequireToken('device')
@ApiBadRequestResponse({ description: 'Invalid body or unknown reference' })
@Controller('api')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Telematics readings ingestion',
    description:
      'Idempotent. `live` batches go through the fuel drop detector.',
  })
  @ApiAcceptedResponse({ standardSchema: TelemetryIngestResult })
  ingestTelemetry(@Body({ schema: TelemetryBatch }) batch: TelemetryBatch) {
    return this.telemetry.ingestTelemetry(batch);
  }

  @Post('fuel-card-transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fuel card transactions ingestion' })
  @ApiOkResponse({ standardSchema: IngestResult })
  ingestFuelCards(@Body({ schema: FuelCardBatch }) batch: FuelCardBatch) {
    return this.telemetry.ingestFuelCards(batch);
  }

  @Post('driver-messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Driver messages ingestion' })
  @ApiOkResponse({ standardSchema: IngestResult })
  ingestDriverMessages(
    @Body({ schema: DriverMessageBatch }) batch: DriverMessageBatch,
  ) {
    return this.telemetry.ingestDriverMessages(batch);
  }
}
