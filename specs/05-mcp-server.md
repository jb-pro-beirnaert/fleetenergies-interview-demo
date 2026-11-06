# 05 — MCP server (`apps/mcp-server`)

Exposes the **7 investigation tools** following the MCP standard (Model Context Protocol). It is a **thin adapter**: each tool validates its arguments, calls the matching API agent route and returns the result. **No business logic, no database access.**

## Why an MCP server (be able to explain it)
The same tools serve several consumers: the investigator agent (V1), the analyst assistant and any MCP-compatible client (V3). The server is also a single control point: authentication, logging and read-only access.

## Technical
- Official SDK `@modelcontextprotocol/sdk` (TypeScript), high-level `McpServer` API (`registerTool`).
- **Streamable HTTP** transport on `MCP_PORT` (default 3100), entry point `POST /mcp`, stateless mode (one request = a fresh server and transport, JSON responses without an SSE stream). Express HTTP server, created by the SDK's `createMcpExpressApp`. Without sessions, `GET` and `DELETE /mcp` answer 405. `GET /health` is open, without a token.
- `--stdio` option to plug in a local client in development (MCP inspector).
- Incoming authentication: `Authorization: Bearer MCP_CLIENT_TOKEN` header (V1: a single token, the workers'; V3: per-role tokens).
- Outgoing calls to the API with `AGENT_API_TOKEN`, 10 s timeout.

## Tools
Input and output schemas: `packages/contracts/src/tools.ts`. For each tool, the **description matters as much as the code**: it is what the model reads to decide when to use it. Descriptions in English, 1 to 3 sentences, saying **when** to use the tool and **what it returns**.

| Tool | API route | Description (to be refined through the evals) |
|---|---|---|
| `get_truck_profile` | `GET /agent/trucks/:truckId/profile` | Truck profile: tank capacity, energy, whether it has a reefer unit, usual consumption, known notes about the fuel sensor. Call it first to get the context. |
| `get_tank_curve` | `GET /agent/trucks/:truckId/tank-curve` | Tank level over a period, summarised: start and end levels, biggest drop (engine off or not), rises without a refuel that may betray a sensor artefact. |
| `get_vehicle_activity` | `GET /agent/trucks/:truckId/activity` | Truck stops with their duration, engine state and place type (fuel station, depot, workshop, motorway rest area, customer). Shows where and under which conditions the decrease happened. |
| `find_fuel_transactions` | `GET /agent/trucks/:truckId/fuel-transactions` | Recorded refuels (fuel cards and invoices) over a period. A drop explained by a badly recorded refuel or an inconsistent invoice shows up here. |
| `read_driver_messages` | `GET /agent/trucks/:truckId/driver-messages` | Free-text messages sent by the driver over a period (pseudonymised). May contain an explanation: workshop job, gauge problem, transfer to the reefer unit. |
| `compute_fuel_balance` | `GET /agent/trucks/:truckId/fuel-balance` | Exact fuel balance calculation: expected consumption from kilometres and idling, refuels, observed decrease and unexplained liters. Use this calculation rather than estimating yourself. |
| `find_similar_events` | `GET /agent/trucks/:truckId/similar-events` | Comparable level drops of the same truck over the previous days, with the time, the place and the past verdict if any. A repeated pattern strengthens a suspicion. |

## Behaviour
- Each tool is declared with its input schema **and its output schema** (those of `packages/contracts`) and the `readOnlyHint: true` annotation.
- Invalid arguments → tool result in error (`isError: true`), so that the model can correct itself. No unhandled exception. Validation is done by the SDK before the tool is called: the message is the SDK's, which reuses the Zod schema messages (for example `MCP error -32602: Input validation error: Invalid arguments for tool compute_fuel_balance: maximum window 72 h at to`). It is not rewritten.
- API error (4xx) → error result with the API message; (5xx or timeout) → error result "service unavailable, try again later".
- Result → text `content` (compact JSON) **and** `structuredContent` (object), as per the SDK. The SDK checks `structuredContent` against the output schema: an API response outside the contract becomes an error result rather than data passed to the model.
- One log line per call **forwarded to the API**: tool, duration, status, API HTTP code, result size. **Never** the content. Calls rejected by the SDK validation are not logged. The log is written to stderr, since stdout is reserved for the protocol in `--stdio` mode.

## Acceptance criteria
1. The official MCP inspector lists the 7 tools with their descriptions and input schemas.
2. Each tool called with valid arguments returns the same content as the matching API route.
3. A call without a token or with a wrong token is refused.
4. Invalid arguments produce a tool result in error, not a crash.
5. The server contains no SQL query and no database dependency.
