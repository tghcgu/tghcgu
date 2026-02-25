"""Core text extraction logic for uzustudio."""

import re
from pathlib import Path
from typing import Union

from .models import ExtractionResult, TextBlock


class TextExtractor:
    """Extract text from various file and string sources.

    Supports plain text, markdown, simple HTML, and CSV files.
    """

    # HTML tag pattern for stripping markup
    _HTML_TAG_RE = re.compile(r"<[^>]+>")
    # Multiple whitespace normalizer
    _WHITESPACE_RE = re.compile(r"[ \t]+")
    # Blank line collapser (3+ newlines -> 2)
    _BLANK_LINES_RE = re.compile(r"\n{3,}")

    def extract_from_string(
        self,
        text: str,
        source: str = "<string>",
        strip_html: bool = False,
    ) -> ExtractionResult:
        """Extract text blocks from a raw string.

        Args:
            text: Input string to process.
            source: Label used in TextBlock metadata.
            strip_html: When True, HTML tags are removed before processing.

        Returns:
            ExtractionResult with one TextBlock per non-empty paragraph.
        """
        if strip_html:
            text = self._HTML_TAG_RE.sub(" ", text)

        text = self._WHITESPACE_RE.sub(" ", text)
        text = self._BLANK_LINES_RE.sub("\n\n", text)

        paragraphs = [p.strip() for p in text.split("\n\n")]
        blocks = [
            TextBlock(text=p, source=source)
            for p in paragraphs
            if p
        ]
        return ExtractionResult(blocks=blocks)

    def extract_from_file(
        self,
        path: Union[str, Path],
        encoding: str = "utf-8",
    ) -> ExtractionResult:
        """Extract text from a file on disk.

        Dispatches to a format-specific reader based on the file extension.
        Supported extensions: .txt, .md, .html, .htm, .csv

        Args:
            path: Path to the source file.
            encoding: Character encoding to use when reading the file.

        Returns:
            ExtractionResult populated from the file contents.

        Raises:
            FileNotFoundError: If *path* does not exist.
            ValueError: If the file extension is not supported.
        """
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        suffix = path.suffix.lower()
        raw = path.read_text(encoding=encoding)

        if suffix in (".txt", ".md"):
            result = self.extract_from_string(raw, source=str(path))
        elif suffix in (".html", ".htm"):
            result = self.extract_from_string(raw, source=str(path), strip_html=True)
        elif suffix == ".csv":
            result = self._extract_from_csv(raw, source=str(path))
        else:
            raise ValueError(
                f"Unsupported file type '{suffix}'. "
                "Supported: .txt, .md, .html, .htm, .csv"
            )

        result.source_path = str(path)
        result.encoding = encoding
        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _extract_from_csv(self, raw: str, source: str) -> ExtractionResult:
        """Extract non-empty cell values from a CSV string."""
        import csv
        import io

        blocks: list[TextBlock] = []
        reader = csv.reader(io.StringIO(raw))
        for row_idx, row in enumerate(reader, start=1):
            for cell in row:
                cell = cell.strip()
                if cell:
                    blocks.append(TextBlock(text=cell, page=row_idx, source=source))
        return ExtractionResult(blocks=blocks)
