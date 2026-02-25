"""Tests for uzustudio.TextExtractor"""

import textwrap
import tempfile
from pathlib import Path

import pytest

from uzustudio import TextExtractor, ExtractionResult, TextBlock


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def extractor():
    return TextExtractor()


@pytest.fixture
def tmp(tmp_path):
    return tmp_path


# ---------------------------------------------------------------------------
# extract_from_string
# ---------------------------------------------------------------------------


class TestExtractFromString:
    def test_single_paragraph(self, extractor):
        result = extractor.extract_from_string("Hello, world!")
        assert isinstance(result, ExtractionResult)
        assert len(result) == 1
        assert result.blocks[0].text == "Hello, world!"

    def test_multiple_paragraphs(self, extractor):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        result = extractor.extract_from_string(text)
        assert len(result) == 3
        assert result.blocks[1].text == "Second paragraph."

    def test_full_text_joins_paragraphs(self, extractor):
        text = "Para one.\n\nPara two."
        result = extractor.extract_from_string(text)
        assert result.full_text == "Para one.\nPara two."

    def test_empty_string_returns_no_blocks(self, extractor):
        result = extractor.extract_from_string("")
        assert len(result) == 0

    def test_whitespace_only_returns_no_blocks(self, extractor):
        result = extractor.extract_from_string("   \n\n   \n\n   ")
        assert len(result) == 0

    def test_normalises_excess_blank_lines(self, extractor):
        text = "A\n\n\n\n\nB"
        result = extractor.extract_from_string(text)
        assert len(result) == 2

    def test_normalises_inline_whitespace(self, extractor):
        result = extractor.extract_from_string("word1   word2\t\tword3")
        assert result.blocks[0].text == "word1 word2 word3"

    def test_source_label_is_stored(self, extractor):
        result = extractor.extract_from_string("text", source="my_label")
        assert result.blocks[0].source == "my_label"

    def test_strip_html_removes_tags(self, extractor):
        html = "<p>Hello <strong>world</strong></p>"
        result = extractor.extract_from_string(html, strip_html=True)
        assert "<" not in result.full_text
        assert "Hello" in result.full_text
        assert "world" in result.full_text

    def test_strip_html_false_keeps_tags(self, extractor):
        html = "<p>Hello</p>"
        result = extractor.extract_from_string(html, strip_html=False)
        assert "<p>" in result.full_text


# ---------------------------------------------------------------------------
# extract_from_file – .txt
# ---------------------------------------------------------------------------


class TestExtractFromTxtFile:
    def test_plain_text_file(self, extractor, tmp):
        f = tmp / "sample.txt"
        f.write_text("Line one.\n\nLine two.")
        result = extractor.extract_from_file(f)
        assert len(result) == 2
        assert result.source_path == str(f)

    def test_encoding_stored_in_result(self, extractor, tmp):
        f = tmp / "utf8.txt"
        f.write_text("テスト", encoding="utf-8")
        result = extractor.extract_from_file(f, encoding="utf-8")
        assert result.encoding == "utf-8"
        assert "テスト" in result.full_text


# ---------------------------------------------------------------------------
# extract_from_file – .md
# ---------------------------------------------------------------------------


class TestExtractFromMarkdownFile:
    def test_markdown_paragraphs(self, extractor, tmp):
        md = textwrap.dedent("""\
            # Title

            First paragraph with **bold** text.

            Second paragraph.
        """)
        f = tmp / "doc.md"
        f.write_text(md)
        result = extractor.extract_from_file(f)
        assert result.page_count == 0  # plain text: no page metadata
        texts = [b.text for b in result]
        assert any("Title" in t for t in texts)
        assert any("First paragraph" in t for t in texts)


# ---------------------------------------------------------------------------
# extract_from_file – .html
# ---------------------------------------------------------------------------


class TestExtractFromHtmlFile:
    def test_html_tags_stripped(self, extractor, tmp):
        html = "<html><body><h1>Title</h1><p>Some text.</p></body></html>"
        f = tmp / "page.html"
        f.write_text(html)
        result = extractor.extract_from_file(f)
        assert "<" not in result.full_text
        assert "Title" in result.full_text
        assert "Some text." in result.full_text

    def test_htm_extension_also_works(self, extractor, tmp):
        f = tmp / "page.htm"
        f.write_text("<p>Hello</p>")
        result = extractor.extract_from_file(f)
        assert "Hello" in result.full_text


# ---------------------------------------------------------------------------
# extract_from_file – .csv
# ---------------------------------------------------------------------------


class TestExtractFromCsvFile:
    def test_csv_cells_extracted(self, extractor, tmp):
        csv_content = "name,age\nAlice,30\nBob,25\n"
        f = tmp / "data.csv"
        f.write_text(csv_content)
        result = extractor.extract_from_file(f)
        texts = [b.text for b in result]
        assert "name" in texts
        assert "Alice" in texts
        assert "25" in texts

    def test_csv_row_stored_as_page(self, extractor, tmp):
        f = tmp / "rows.csv"
        f.write_text("a,b\nc,d\n")
        result = extractor.extract_from_file(f)
        pages = {b.page for b in result}
        assert 1 in pages
        assert 2 in pages

    def test_csv_empty_cells_skipped(self, extractor, tmp):
        f = tmp / "sparse.csv"
        f.write_text("hello,,world\n")
        result = extractor.extract_from_file(f)
        texts = [b.text for b in result]
        assert "" not in texts
        assert "hello" in texts
        assert "world" in texts


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


class TestErrors:
    def test_file_not_found(self, extractor):
        with pytest.raises(FileNotFoundError):
            extractor.extract_from_file("/nonexistent/path/file.txt")

    def test_unsupported_extension(self, extractor, tmp):
        f = tmp / "doc.pdf"
        f.write_bytes(b"%PDF-1.4 fake")
        with pytest.raises(ValueError, match="Unsupported file type"):
            extractor.extract_from_file(f)


# ---------------------------------------------------------------------------
# ExtractionResult helpers
# ---------------------------------------------------------------------------


class TestExtractionResult:
    def test_iter(self):
        blocks = [TextBlock(text="a"), TextBlock(text="b")]
        result = ExtractionResult(blocks=blocks)
        assert list(result) == blocks

    def test_len(self):
        result = ExtractionResult(blocks=[TextBlock(text="x")] * 5)
        assert len(result) == 5

    def test_page_count(self):
        blocks = [
            TextBlock(text="p1", page=1),
            TextBlock(text="p1b", page=1),
            TextBlock(text="p2", page=2),
        ]
        result = ExtractionResult(blocks=blocks)
        assert result.page_count == 2

    def test_textblock_str(self):
        b = TextBlock(text="hello")
        assert str(b) == "hello"
