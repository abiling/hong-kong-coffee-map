import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

from playwright.async_api import async_playwright

SOURCE_URL = sys.argv[1]
OUTPUT = Path('tmp/tokyo-coffee-list.json')

COORD_PATTERNS = [
    re.compile(r'@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)'),
    re.compile(r'!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)'),
]


def coords_from_url(url: str):
    decoded = unquote(url or '')
