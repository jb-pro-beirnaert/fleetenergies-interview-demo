"""Render an animated GIF of the Fleet Copilot data flows (scripts/data-flow.gif).

Usage (needs Pillow, kept outside the npm workspaces on purpose):
    python3 -m venv .venv && .venv/bin/pip install pillow
    .venv/bin/python scripts/data-flow-gif.py

Fonts are read from macOS system fonts; adjust FONT_* paths on other systems.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 740
OUT = Path(__file__).with_name("data-flow.gif")

FONT_SANS = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_MONO = "/System/Library/Fonts/Menlo.ttc"
f_title = ImageFont.truetype(FONT_SANS, 26, index=1)
f_node = ImageFont.truetype(FONT_SANS, 19, index=1)
f_sub = ImageFont.truetype(FONT_SANS, 13)
f_cap = ImageFont.truetype(FONT_SANS, 19)
f_pkt = ImageFont.truetype(FONT_MONO, 13)
f_tag = ImageFont.truetype(FONT_SANS, 16, index=2)

BG = (248, 250, 252)
INK = (30, 41, 59)
MUTED = (100, 116, 139)
EDGE = (214, 221, 230)

# Colour by responsibility: code computes, AI investigates, human decides.
CODE = (37, 99, 235)
DATA = (71, 85, 105)
AI = (124, 58, 237)
HUMAN = (22, 163, 74)
EXT = (180, 83, 9)

NW, NH = 190, 70
NODES = {
    "web": ((140, 165), "web", "control room · human", HUMAN),
    "simulator": ((140, 375), "simulator", "telematics + suppliers", EXT),
    "nestjs": ((470, 375), "nestjs (API)", "detects · computes · decides", CODE),
    "postgres": ((470, 560), "postgres", "data + task queue", DATA),
    "mcp": ((790, 165), "mcp-server", "7 read-only tools", CODE),
    "investigator": ((790, 375), "investigator", "agent loop", AI),
    "extractor": ((790, 560), "extractor", "invoice worker", AI),
    "ollama": ((1075, 465), "Ollama", "fleet-qwen (local LLM)", AI),
}
EDGES = [
    ("simulator", "nestjs"), ("nestjs", "postgres"), ("nestjs", "web"),
    ("investigator", "nestjs"), ("investigator", "mcp"), ("mcp", "nestjs"),
    ("investigator", "ollama"), ("extractor", "nestjs"), ("extractor", "ollama"),
]

V1 = "V1 · Fuel drop investigation"
V2 = "V2 · Invoice reconciliation"

# (phase, kind, a, b, packet label, caption). kind "move" goes a -> b, "pulse" highlights a.
STEPS = [
    (V1, "move", "simulator", "nestjs", "telemetry (live)", "Telematics boxes stream fuel levels and GPS to the API (idempotent ingestion)."),
    (V1, "pulse", "nestjs", None, "fuel_drop rule", "Code detects: the fuel drop rule runs on every live batch."),
    (V1, "move", "nestjs", "postgres", "alert + task", "An alert and an investigation task are written to Postgres."),
    (V1, "move", "investigator", "nestjs", "claim task", "The investigator polls and claims the task (FOR UPDATE SKIP LOCKED)."),
    (V1, "move", "nestjs", "investigator", "alert context", "It receives the alert context, pseudonymised (C-xx, no names or phones)."),
    (V1, "move", "investigator", "ollama", "prompt + tools", "Hand-written agent loop: the local model reasons and picks a tool."),
    (V1, "move", "ollama", "investigator", "tool call", "AI investigates: the model asks for evidence."),
    (V1, "move", "investigator", "mcp", "get_fuel_timeline", "The worker calls the MCP server, which only exposes read-only tools."),
    (V1, "move", "mcp", "nestjs", "/agent/trucks/*", "The MCP server is a thin adapter over the API: no SQL, no business logic."),
    (V1, "move", "nestjs", "mcp", "summary ≤ 30 pts", "The API computes balances and stops in code, summarised and PII-masked."),
    (V1, "move", "mcp", "investigator", "{ref: E1, result}", "Each tool result is wrapped with an evidence reference (E1, E2, ...)."),
    (V1, "move", "investigator", "ollama", "evidence E1..E3", "Evidence goes back to the model, loop after loop."),
    (V1, "move", "ollama", "investigator", "submit_verdict", "The model ends with submit_verdict, a tool local to the worker."),
    (V1, "move", "investigator", "nestjs", "verdict + refs", "The verdict cites E1..En; the API re-checks every ref (422 otherwise)."),
    (V1, "pulse", "nestjs", None, "decide", "The API decides in code: theft / inconclusive → escalate, confident → auto-close."),
    (V1, "move", "nestjs", "web", "escalated alert", "The control room polls every 2 s and shows the evidence-backed verdict."),
    (V1, "pulse", "web", None, "human review", "The human decides."),
    (V2, "move", "simulator", "nestjs", "invoice.pdf", "A supplier sends a PDF invoice; text extraction + injection check in code."),
    (V2, "move", "nestjs", "postgres", "extraction task", "An extraction task is queued in Postgres."),
    (V2, "move", "extractor", "nestjs", "claim + text", "The extractor claims the task and gets the invoice text."),
    (V2, "move", "extractor", "ollama", "invoice text", "The model turns free text into structured lines..."),
    (V2, "move", "ollama", "extractor", "structured output", "...validated against a Zod schema (local time converted in code)."),
    (V2, "move", "extractor", "nestjs", "invoice lines", "Extracted lines go back to the API."),
    (V2, "pulse", "nestjs", None, "reconcile", "Code reconciles invoice vs. telemetry (litres, place, time)."),
    (V2, "move", "nestjs", "postgres", "billing_mismatch", "Mismatch → billing_mismatch alert → same investigator loop → human."),
]

MOVE_FRAMES, HOLD_FRAMES, PULSE_FRAMES = 16, 9, 18
FRAME_MS = 60


def mix(c, t, base=(255, 255, 255)):
    return tuple(int(base[i] + (c[i] - base[i]) * t) for i in range(3))


def border_point(name, toward):
    """Point where the segment from the node centre to `toward` leaves the node box."""
    (cx, cy) = NODES[name][0]
    dx, dy = toward[0] - cx, toward[1] - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (NW / 2) / abs(dx) if dx else float("inf")
    sy = (NH / 2) / abs(dy) if dy else float("inf")
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s


def endpoints(a, b):
    pa, pb = NODES[a][0], NODES[b][0]
    return border_point(a, pb), border_point(b, pa)


def ease(t):
    return t * t * (3 - 2 * t)


def draw_base(d, phase, active_edge=None, active_nodes=(), glow=0.0):
    d.rectangle((0, 0, W, H), fill=BG)
    d.text((40, 28), "Fleet Copilot · data flows", font=f_title, fill=INK)
    d.text((W - 40, 34), phase, font=f_cap, fill=MUTED, anchor="ra")

    for a, b in EDGES:
        p, q = endpoints(a, b)
        on = active_edge in ((a, b), (b, a))
        d.line((p, q), fill=(148, 163, 184) if on else EDGE, width=4 if on else 2)

    for name, ((cx, cy), title, sub, col) in NODES.items():
        on = name in active_nodes
        box = (cx - NW / 2, cy - NH / 2, cx + NW / 2, cy + NH / 2)
        if on and glow > 0:
            g = 6 + 10 * glow
            d.rounded_rectangle((box[0] - g, box[1] - g, box[2] + g, box[3] + g), 18, fill=mix(col, 0.18))
        d.rounded_rectangle(box, 12, fill=mix(col, 0.16 if on else 0.08), outline=col, width=3 if on else 2)
        d.text((cx, cy - 10), title, font=f_node, fill=col, anchor="mm")
        d.text((cx, cy + 15), sub, font=f_sub, fill=MUTED, anchor="mm")

    # Legend + guiding principle.
    lx = 40
    for label, col in (("code", CODE), ("AI", AI), ("human", HUMAN), ("data", DATA), ("outside world", EXT)):
        d.ellipse((lx, 82, lx + 12, 94), fill=col)
        d.text((lx + 18, 88), label, font=f_sub, fill=MUTED, anchor="lm")
        lx += 30 + d.textlength(label, font=f_sub)
    d.text((W / 2, H - 20), "Code detects and computes · AI investigates and explains · the human decides",
           font=f_tag, fill=MUTED, anchor="mm")


def draw_caption(d, n, caption):
    d.rounded_rectangle((40, H - 92, W - 40, H - 46), 10, fill=(255, 255, 255), outline=EDGE)
    d.text((60, H - 69), f"{n:02d}", font=f_node, fill=MUTED, anchor="lm")
    d.text((100, H - 69), caption, font=f_cap, fill=INK, anchor="lm")


def draw_packet(d, x, y, label, col):
    tw = d.textlength(label, font=f_pkt)
    d.rounded_rectangle((x - tw / 2 - 10, y - 13, x + tw / 2 + 10, y + 13), 13, fill=col)
    d.text((x, y), label, font=f_pkt, fill=(255, 255, 255), anchor="mm")


def node_color(name):
    return NODES[name][3]


def render():
    frames = []
    for n, (phase, kind, a, b, label, caption) in enumerate(STEPS, start=1):
        if kind == "move":
            p, q = endpoints(a, b)
            col = node_color(a)
            for i in range(MOVE_FRAMES + HOLD_FRAMES):
                t = ease(min(i / (MOVE_FRAMES - 1), 1.0))
                img = Image.new("RGB", (W, H))
                d = ImageDraw.Draw(img)
                arrived = i >= MOVE_FRAMES
                draw_base(d, phase, (a, b), (a, b) if arrived else (a,), 0.6 if arrived else 0.0)
                draw_caption(d, n, caption)
                x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
                draw_packet(d, x, y, label, col)
                frames.append(img)
        else:
            col = node_color(a)
            cx, cy = NODES[a][0]
            for i in range(PULSE_FRAMES):
                glow = abs(((i / (PULSE_FRAMES - 1)) * 2) % 2 - 1)
                img = Image.new("RGB", (W, H))
                d = ImageDraw.Draw(img)
                draw_base(d, phase, None, (a,), 1 - glow)
                draw_caption(d, n, caption)
                draw_packet(d, cx, cy - NH / 2 - 26, label, col)
                frames.append(img)

    # Final hold on the full picture.
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    draw_base(d, "V1 + V2", None, tuple(NODES), 0.0)
    draw_caption(d, len(STEPS) + 1, "Every finding cites its evidence; every decision stays in code or with a human.")
    frames.extend([img] * 40)

    pal = [f.quantize(colors=64, method=Image.Quantize.MEDIANCUT) for f in frames]
    pal[0].save(OUT, save_all=True, append_images=pal[1:], duration=FRAME_MS, loop=0, optimize=True)
    print(f"{OUT} · {len(frames)} frames · {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    render()
