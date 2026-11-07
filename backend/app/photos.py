import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_SIDE = 1280
Image.MAX_IMAGE_PIXELS = 40_000_000


class InvalidPhoto(ValueError):
    pass


def clean(raw: bytes) -> tuple[bytes, int, int]:
    """Re-encode as a JPEG with no metadata, so phone GPS tags never leave the server."""
    if len(raw) > MAX_BYTES:
        raise InvalidPhoto("Photo is larger than 10 MB")
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidPhoto("Not a readable image") from exc
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True)
    return out.getvalue(), img.width, img.height
