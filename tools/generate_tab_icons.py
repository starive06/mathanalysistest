"""Generate crisp 81x81 tab bar icons for the WeChat mini program."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "miniprogram" / "assets" / "tabbar"
SCALE = 4
SIZE = 81
COLORS = {"normal": "#7A7E83", "active": "#07C160"}
FILLS = {"normal": None, "active": "#E9F8EF"}


def canvas():
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def stroke(draw, points, color, width=5, closed=False):
    scaled = [(int(x * SCALE), int(y * SCALE)) for x, y in points]
    if closed:
        scaled.append(scaled[0])
    draw.line(scaled, fill=color, width=int(width * SCALE), joint="curve")


def draw_chat(draw, color, fill):
    box = (13 * SCALE, 16 * SCALE, 68 * SCALE, 57 * SCALE)
    if fill:
        draw.rounded_rectangle(box, radius=14 * SCALE, fill=fill)
    draw.rounded_rectangle(box, radius=14 * SCALE, outline=color, width=5 * SCALE)
    # Pillow accepts ints for widths; all widths used below are whole pixels at 4x.

    # Tail
    stroke(draw, [(27, 56), (25, 66), (38, 57)], color, width=5)
    draw.ellipse(
        (
            (32 - 3.4) * SCALE,
            (36 - 3.4) * SCALE,
            (32 + 3.4) * SCALE,
            (36 + 3.4) * SCALE,
        ),
        fill=color,
    )
    draw.ellipse(
        (
            (41 - 3.4) * SCALE,
            (36 - 3.4) * SCALE,
            (41 + 3.4) * SCALE,
            (36 + 3.4) * SCALE,
        ),
        fill=color,
    )
    draw.ellipse(
        (
            (50 - 3.4) * SCALE,
            (36 - 3.4) * SCALE,
            (50 + 3.4) * SCALE,
            (36 + 3.4) * SCALE,
        ),
        fill=color,
    )


def draw_history(draw, color, fill):
    circle = (13 * SCALE, 13 * SCALE, 68 * SCALE, 68 * SCALE)
    if fill:
        draw.ellipse(circle, fill=fill)
    draw.ellipse(circle, outline=color, width=5 * SCALE)
    # Clock hands
    stroke(draw, [(40.5, 25), (40.5, 41.5), (51, 48)], color, width=5)
    # Small reverse arrow at the top left
    stroke(draw, [(16.5, 20), (16.5, 30.5), (27, 30.5)], color, width=4)
    draw.ellipse(
        (
            (40.5 - 3) * SCALE,
            (41.5 - 3) * SCALE,
            (40.5 + 3) * SCALE,
            (41.5 + 3) * SCALE,
        ),
        fill=color,
    )


def draw_community(draw, color, fill):
    if fill:
        draw.ellipse((28 * SCALE, 15 * SCALE, 53 * SCALE, 40 * SCALE), fill=fill)
        draw.ellipse((7 * SCALE, 23 * SCALE, 23 * SCALE, 39 * SCALE), fill=fill)
        draw.ellipse((58 * SCALE, 23 * SCALE, 74 * SCALE, 39 * SCALE), fill=fill)
    # Main person
    draw.ellipse(
        (30 * SCALE, 17 * SCALE, 51 * SCALE, 38 * SCALE),
        outline=color,
        width=int(4.5 * SCALE),
    )
    draw.arc(
        (20 * SCALE, 35 * SCALE, 61 * SCALE, 73 * SCALE),
        start=195,
        end=345,
        fill=color,
        width=int(4.5 * SCALE),
    )
    # Side people
    draw.ellipse(
        (9 * SCALE, 25 * SCALE, 22 * SCALE, 38 * SCALE),
        outline=color,
        width=4 * SCALE,
    )
    draw.arc(
        (3 * SCALE, 39 * SCALE, 31 * SCALE, 64 * SCALE),
        start=200,
        end=340,
        fill=color,
        width=4 * SCALE,
    )
    draw.ellipse(
        (59 * SCALE, 25 * SCALE, 72 * SCALE, 38 * SCALE),
        outline=color,
        width=4 * SCALE,
    )
    draw.arc(
        (50 * SCALE, 39 * SCALE, 78 * SCALE, 64 * SCALE),
        start=200,
        end=340,
        fill=color,
        width=4 * SCALE,
    )


def draw_book(draw, color, fill):
    cover = (16 * SCALE, 12 * SCALE, 65 * SCALE, 69 * SCALE)
    if fill:
        draw.rounded_rectangle(cover, radius=6 * SCALE, fill=fill)
    draw.rounded_rectangle(
        cover,
        radius=6 * SCALE,
        outline=color,
        width=5 * SCALE,
    )
    # Spine
    stroke(draw, [(27, 13), (27, 68)], color, width=4)
    # Page lines
    stroke(draw, [(36, 27), (56, 27)], color, width=3)
    stroke(draw, [(36, 37), (56, 37)], color, width=3)
    stroke(draw, [(36, 47), (49, 47)], color, width=3)
    # Bookmark ribbon
    stroke(draw, [(49, 12), (49, 27), (54.5, 22.5), (60, 27), (60, 12)], color, width=3)


ICON_BUILDERS = {
    "chat": draw_chat,
    "history": draw_history,
    "community": draw_community,
    "resources": draw_book,
}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, builder in ICON_BUILDERS.items():
        for state, color in COLORS.items():
            image, draw = canvas()
            builder(draw, color, FILLS[state])
            image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            target = OUTPUT / f"{name}-{state}.png"
            image.save(target, optimize=True)
            print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
