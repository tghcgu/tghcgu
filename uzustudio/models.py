"""Data models for text extraction results."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TextBlock:
    """A block of extracted text with metadata."""

    text: str
    page: Optional[int] = None
    confidence: float = 1.0
    source: Optional[str] = None

    def __str__(self) -> str:
        return self.text


@dataclass
class ExtractionResult:
    """Result of a text extraction operation."""

    blocks: list[TextBlock] = field(default_factory=list)
    source_path: Optional[str] = None
    encoding: str = "utf-8"

    @property
    def full_text(self) -> str:
        """Return all extracted text joined by newlines."""
        return "\n".join(block.text for block in self.blocks if block.text.strip())

    @property
    def page_count(self) -> int:
        """Return the number of distinct pages found."""
        pages = {block.page for block in self.blocks if block.page is not None}
        return len(pages)

    def __len__(self) -> int:
        return len(self.blocks)

    def __iter__(self):
        return iter(self.blocks)
