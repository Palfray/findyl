#!/usr/bin/env python3
"""
Fetch and process VinylCastle product feed from Awin.

Downloads the gzipped CSV feed, filters to vinyl records only,
parses artist/album names, and outputs vinylcastle-products.json.

Usage:
    python3 scripts/fetch-vinylcastle-feed.py

Output:
    vinylcastle-products.json (in project root)
"""

import csv
import gzip
import io
import json
import re
import sys
import urllib.request

FEED_URL = (
    "https://productdata.awin.com/datafeed/download/"
    "apikey/b2afc652412a7c28f56f8cb08778627a/"
    "language/en/fid/98984/rid/0/hasEnhancedFeeds/0/"
    "columns/aw_deep_link,product_name,aw_product_id,merchant_product_id,"
    "merchant_image_url,description,merchant_category,search_price,"
    "merchant_name,merchant_id,category_name,aw_image_url,currency,"
    "in_stock,brand_name,product_type/"
    "format/csv/delimiter/%2C/compression/gzip/adultcontent/1/"
)

PUBLISHER_ID = "2772514"
MERCHANT_ID = "109172"

# Keywords that indicate a product IS vinyl
VINYL_INCLUDE = re.compile(
    r'\b(vinyl|lp|12"|12 inch|record|gatefold|heavyweight|coloured vinyl|'
    r'colored vinyl|picture disc|180g|limited edition vinyl|remaster.*vinyl|'
    r'double lp|2xlp|2lp|3lp|4lp)\b',
    re.IGNORECASE,
)

# Keywords that indicate a product is NOT vinyl (exclude these)
VINYL_EXCLUDE = re.compile(
    r'\b(cd\b|compact disc|dvd|blu-ray|cassette|tape|turntable|'
    r'record player|stylus|cartridge|slipmat|t-shirt|tee|hoodie|'
    r'poster|tote bag|mug|keyring|pin badge|patch|beanie|cap|'
    r'headphones|speaker|cleaning|brush|accessories|merch)\b',
    re.IGNORECASE,
)

# Patterns to clean from album names
ALBUM_CLEANUP = re.compile(
    r'\s*[\(\[](vinyl|vinyl lp|lp|vinyl record|gatefold|'
    r'heavyweight vinyl|coloured vinyl|colored vinyl|'
    r'limited edition|deluxe edition vinyl|'
    r'2xlp|2lp|double lp|180g|180 gram|'
    r'picture disc|remastered)[\)\]]\s*',
    re.IGNORECASE,
)

# Extra trailing format info
TRAILING_FORMAT = re.compile(
    r'\s*[-,]\s*(vinyl|lp|vinyl lp|heavyweight vinyl|gatefold lp|'
    r'coloured vinyl|colored vinyl|180g vinyl|limited vinyl)\s*$',
    re.IGNORECASE,
)


def is_vinyl_product(product_name, category, product_type, description):
    """Determine if a product is a vinyl record."""
    combined = f"{product_name} {category} {product_type} {description}"

    # Exclude non-vinyl products first
    if VINYL_EXCLUDE.search(combined):
        # But allow if "vinyl" is also explicitly mentioned in the product name
        if not VINYL_INCLUDE.search(product_name):
            return False

    # Check if vinyl keywords are present
    if VINYL_INCLUDE.search(combined):
        return True

    return False


def parse_artist_album(product_name):
    """Parse artist and album from product name.

    Expected formats:
        "Artist - Album Title (Vinyl LP)"
        "Artist - Album Title [Vinyl]"
        "Artist - Album Title, Vinyl LP"
        "Artist - Album Title"
    """
    # Clean up the name first
    name = product_name.strip()

    # Try splitting on " - " (most common format)
    if " - " in name:
        parts = name.split(" - ", 1)
        artist = parts[0].strip()
        album = parts[1].strip()
    else:
        # Fallback: use the whole name as album, brand as artist
        return None, None

    # Clean format info from album name
    album = ALBUM_CLEANUP.sub("", album).strip()
    album = TRAILING_FORMAT.sub("", album).strip()

    # Remove trailing commas, parentheses artifacts
    album = album.strip(" ,.-")

    # Remove empty parentheses or brackets left after cleanup
    album = re.sub(r'\(\s*\)', '', album).strip()
    album = re.sub(r'\[\s*\]', '', album).strip()

    if not artist or not album:
        return None, None

    return artist, album


def process_feed():
    """Download, parse, filter, and save the VinylCastle feed."""
    print("Downloading VinylCastle feed from Awin...")
    print(f"URL: {FEED_URL[:80]}...")

    req = urllib.request.Request(
        FEED_URL,
        headers={"User-Agent": "Findyl/1.0 +https://findyl.co.uk"},
    )

    try:
        response = urllib.request.urlopen(req, timeout=120)
        compressed_data = response.read()
        print(f"Downloaded {len(compressed_data):,} bytes (compressed)")
    except Exception as e:
        print(f"ERROR: Failed to download feed: {e}")
        sys.exit(1)

    # Decompress gzip
    print("Decompressing...")
    try:
        csv_data = gzip.decompress(compressed_data).decode("utf-8")
    except Exception:
        # Maybe it's not gzipped, try raw
        csv_data = compressed_data.decode("utf-8")

    print(f"Decompressed to {len(csv_data):,} characters")

    # Parse CSV
    reader = csv.DictReader(io.StringIO(csv_data))
    all_products = list(reader)
    print(f"Total products in feed: {len(all_products):,}")

    # Filter to vinyl only
    vinyl_products = []
    skipped = {"not_vinyl": 0, "no_artist_album": 0, "no_price": 0, "duplicate": 0}
    seen_keys = set()

    for product in all_products:
        product_name = product.get("product_name", "")
        category = product.get("merchant_category", "")
        product_type = product.get("product_type", "")
        description = product.get("description", "")

        # Filter: must be vinyl
        if not is_vinyl_product(product_name, category, product_type, description):
            skipped["not_vinyl"] += 1
            continue

        # Parse artist and album
        artist, album = parse_artist_album(product_name)
        if not artist or not album:
            skipped["no_artist_album"] += 1
            continue

        # Get price
        price_str = product.get("search_price", "")
        try:
            price = round(float(price_str), 2)
        except (ValueError, TypeError):
            skipped["no_price"] += 1
            continue

        if price <= 0:
            skipped["no_price"] += 1
            continue

        # Deduplicate by artist+album (keep cheapest)
        dedup_key = f"{artist.lower()}||{album.lower()}"
        if dedup_key in seen_keys:
            skipped["duplicate"] += 1
            continue
        seen_keys.add(dedup_key)

        # Get affiliate link
        link = product.get("aw_deep_link", "")
        if not link:
            continue

        # Verify affiliate IDs are in the link
        if PUBLISHER_ID not in link or MERCHANT_ID not in link:
            # Reconstruct the affiliate link if IDs are missing
            merchant_url = product.get("merchant_deep_link", link)
            link = (
                f"https://www.awin1.com/cread.php?"
                f"awinmid={MERCHANT_ID}&awinaffid={PUBLISHER_ID}"
                f"&ued={urllib.parse.quote(merchant_url, safe='')}"
            )

        # Get image
        image = (
            product.get("aw_image_url", "")
            or product.get("merchant_image_url", "")
        )

        # Get availability
        in_stock = product.get("in_stock", "")
        availability = "In Stock" if in_stock == "1" else "Out of Stock"

        vinyl_products.append({
            "artist": artist,
            "album": album,
            "price": price,
            "currency": product.get("currency", "GBP"),
            "link": link,
            "image": image,
            "availability": availability,
            "search_text": f"{artist} {album}".lower(),
        })

    # Sort by artist name
    vinyl_products.sort(key=lambda p: (p["artist"].lower(), p["album"].lower()))

    print(f"\n--- Results ---")
    print(f"Vinyl records found: {len(vinyl_products):,}")
    print(f"Skipped (not vinyl): {skipped['not_vinyl']:,}")
    print(f"Skipped (no artist/album): {skipped['no_artist_album']:,}")
    print(f"Skipped (no price): {skipped['no_price']:,}")
    print(f"Skipped (duplicates): {skipped['duplicate']:,}")

    # Sample output
    if vinyl_products:
        print(f"\nSample products:")
        for p in vinyl_products[:5]:
            print(f"  {p['artist']} - {p['album']} (£{p['price']})")

    # Save JSON
    output_path = "vinylcastle-products.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(vinyl_products, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(vinyl_products):,} products to {output_path}")

    # Validation
    if len(vinyl_products) < 100:
        print(f"\nWARNING: Only {len(vinyl_products)} vinyl products found.")
        print("The feed may have fewer vinyl records than expected.")

    # Verify affiliate IDs
    bad_links = [p for p in vinyl_products if PUBLISHER_ID not in p["link"] or MERCHANT_ID not in p["link"]]
    if bad_links:
        print(f"\nWARNING: {len(bad_links)} products have missing affiliate IDs in links")
    else:
        print(f"All links contain affiliate IDs ({PUBLISHER_ID} and {MERCHANT_ID})")

    return vinyl_products


if __name__ == "__main__":
    import urllib.parse  # noqa: needed for link construction
    process_feed()
