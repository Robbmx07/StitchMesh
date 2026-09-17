#!/usr/bin/env python3
"""Convert docs/MANUAL.md to a polished PDF with embedded screenshots.

Requires: pip install markdown reportlab pillow
Usage:    python3 scripts/build-manual-pdf.py
Regenerate this whenever docs/MANUAL.md or docs/manual-assets/ changes.
"""
import re
import datetime
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, NextPageTemplate, PageBreak,
    Paragraph, Spacer, Image, Table, TableStyle, HRFlowable,
    KeepTogether,
)
from reportlab.platypus.flowables import Flowable
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas as pdfcanvas

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
MANUAL_MD = DOCS / 'MANUAL.md'
ASSETS = DOCS / 'manual-assets'
OUT_PDF = DOCS / 'StitchMesh-User-Manual.pdf'

PAGE_W, PAGE_H = LETTER
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------
styles = getSampleStyleSheet()

ACCENT = colors.HexColor('#1d4ed8')
DARK = colors.HexColor('#0f172a')
MUTED = colors.HexColor('#475569')
RULE = colors.HexColor('#cbd5e1')
CODE_BG = colors.HexColor('#0f172a')
CODE_FG = colors.HexColor('#e2e8f0')
TABLE_HEAD_BG = colors.HexColor('#1d4ed8')
TABLE_ALT_BG = colors.HexColor('#f1f5f9')

styles.add(ParagraphStyle(
    'CoverTitle', fontName='Helvetica-Bold', fontSize=34, leading=40,
    alignment=TA_CENTER, textColor=DARK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    'CoverSubtitle', fontName='Helvetica', fontSize=16, leading=20,
    alignment=TA_CENTER, textColor=ACCENT, spaceAfter=18,
))
styles.add(ParagraphStyle(
    'CoverTagline', fontName='Helvetica-Oblique', fontSize=13, leading=18,
    alignment=TA_CENTER, textColor=MUTED, spaceAfter=28,
))
styles.add(ParagraphStyle(
    'CoverMeta', fontName='Helvetica', fontSize=10, leading=14,
    alignment=TA_CENTER, textColor=MUTED,
))
styles.add(ParagraphStyle(
    'H1', fontName='Helvetica-Bold', fontSize=20, leading=24,
    textColor=DARK, spaceBefore=6, spaceAfter=12,
))
styles.add(ParagraphStyle(
    'H2', fontName='Helvetica-Bold', fontSize=15, leading=19,
    textColor=ACCENT, spaceBefore=18, spaceAfter=8,
))
styles.add(ParagraphStyle(
    'H3', fontName='Helvetica-Bold', fontSize=12, leading=15,
    textColor=DARK, spaceBefore=12, spaceAfter=6,
))
styles.add(ParagraphStyle(
    'Body', fontName='Helvetica', fontSize=9.8, leading=14.5,
    textColor=DARK, spaceAfter=7, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    'Caption', fontName='Helvetica-Oblique', fontSize=8.7, leading=12.5,
    textColor=MUTED, spaceAfter=14, spaceBefore=4, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    'ManualBullet', fontName='Helvetica', fontSize=9.8, leading=14.5,
    textColor=DARK, spaceAfter=4, leftIndent=16, bulletIndent=2,
))
styles.add(ParagraphStyle(
    'CodeBlock', fontName='Courier', fontSize=8.7, leading=12.5,
    textColor=CODE_FG, backColor=CODE_BG, borderPadding=(8, 10, 8, 10),
    spaceAfter=12, spaceBefore=4,
))
styles.add(ParagraphStyle(
    'TableCell', fontName='Helvetica', fontSize=8.6, leading=11.5,
    textColor=DARK,
))
styles.add(ParagraphStyle(
    'TableHead', fontName='Helvetica-Bold', fontSize=8.8, leading=11.5,
    textColor=colors.white,
))
styles.add(ParagraphStyle('TOCHeading', fontName='Helvetica-Bold', fontSize=18,
                           textColor=DARK, spaceAfter=14))
styles.add(ParagraphStyle('TOC1', fontName='Helvetica-Bold', fontSize=10.5,
                           leading=16, textColor=DARK, leftIndent=0))
styles.add(ParagraphStyle('TOC2', fontName='Helvetica', fontSize=9.5,
                           leading=14, textColor=MUTED, leftIndent=14))

# ---------------------------------------------------------------------------
# Inline markdown -> reportlab mini-markup
# ---------------------------------------------------------------------------

def inline(text: str) -> str:
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    # inline code `...`
    text = re.sub(r'`([^`]+)`',
                   lambda m: f'<font face="Courier" size="8.6" color="#1d4ed8">{m.group(1)}</font>',
                   text)
    # bold **...**
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    # italic *...*
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', text)
    # links [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<font color="#1d4ed8">\1</font>', text)
    return text


def para(text: str, style='Body'):
    return Paragraph(inline(text), styles[style])


# ---------------------------------------------------------------------------
# Heading flowables that register TOC entries + PDF bookmarks
# ---------------------------------------------------------------------------
_heading_counter = [0]

class HeadingParagraph(Paragraph):
    def __init__(self, text, style, level):
        self.level = level
        self._bookmark_key = f'h{_heading_counter[0]}'
        _heading_counter[0] += 1
        super().__init__(text, style)

    def draw(self):
        super().draw()
        key = self._bookmark_key
        canv = self.canv
        canv.bookmarkPage(key)
        canv.addOutlineEntry(re.sub('<[^<]+?>', '', self.getPlainText()) if hasattr(self, 'getPlainText') else '',
                              key, level=self.level, closed=False)

    def afterFlowable(self, *_args, **_kwargs):
        pass


def heading(text, level):
    style = {1: 'H1', 2: 'H2', 3: 'H3'}[level]
    plain = re.sub(r'[`*]', '', text)
    p = HeadingParagraph(inline(text), styles[style], level - 2 if level > 1 else 0)
    p._toc_text = plain
    p._toc_level = 0 if level == 2 else 1
    return p


# ---------------------------------------------------------------------------
# Image sizing
# ---------------------------------------------------------------------------

def make_image(path: Path, max_w=CONTENT_W, max_w_scale=1.0):
    with PILImage.open(path) as im:
        w_px, h_px = im.size
    target_w = max_w * max_w_scale
    target_h = target_w * (h_px / w_px)
    return Image(str(path), width=target_w, height=target_h)


# ---------------------------------------------------------------------------
# Table parsing (GFM pipe tables)
# ---------------------------------------------------------------------------

def parse_table(lines):
    rows = [l.strip() for l in lines if l.strip()]
    def split_row(row):
        row = row.strip()
        if row.startswith('|'):
            row = row[1:]
        if row.endswith('|'):
            row = row[:-1]
        return [c.strip() for c in row.split('|')]

    header = split_row(rows[0])
    body_rows = [split_row(r) for r in rows[2:]]
    ncols = len(header)

    data = [[Paragraph(inline(h), styles['TableHead']) for h in header]]
    for r in body_rows:
        r = (r + [''] * ncols)[:ncols]
        data.append([Paragraph(inline(c), styles['TableCell']) for c in r])

    col_w = CONTENT_W / ncols
    t = Table(data, colWidths=[col_w] * ncols, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEAD_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, RULE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_ALT_BG))
    t.setStyle(TableStyle(style_cmds))
    return t


IMG_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')


def parse_manual(md_text: str):
    lines = md_text.split('\n')
    story = []
    i = 0
    n = len(lines)

    # Skip the leading H1 title line (used on the custom cover instead).
    if lines and lines[0].startswith('# '):
        i = 1

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith('```'):
            i += 1
            code_lines = []
            while i < n and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            code_text = '\n'.join(code_lines)
            code_text = code_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            code_text = code_text.replace('\n', '<br/>').replace(' ', '&nbsp;')
            story.append(Paragraph(code_text, styles['CodeBlock']))
            continue

        if stripped.startswith('#'):
            m = re.match(r'(#+)\s*(.*)', stripped)
            level = min(len(m.group(1)), 3)
            story.append(heading(m.group(2), level))
            i += 1
            continue

        if stripped == '---':
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width=CONTENT_W, thickness=0.75, color=RULE,
                                     spaceBefore=2, spaceAfter=14))
            i += 1
            continue

        if stripped.startswith('|'):
            table_lines = []
            while i < n and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            story.append(Spacer(1, 2))
            story.append(parse_table(table_lines))
            story.append(Spacer(1, 10))
            continue

        img_matches = IMG_RE.findall(stripped)
        if img_matches:
            # gather caption on the following non-blank line if italicized
            caption_text = None
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n:
                cand = lines[j].strip()
                if cand.startswith('*') and cand.endswith('*') and not cand.startswith('**'):
                    caption_text = cand[1:-1]
                    i = j + 1
                else:
                    i += 1
            else:
                i += 1

            if len(img_matches) == 1:
                _, src = img_matches[0]
                img_path = ASSETS / Path(src).name
                story.append(KeepTogether([
                    make_image(img_path, max_w=5.6 * inch),
                ]))
            else:
                cells = []
                for _, src in img_matches:
                    img_path = ASSETS / Path(src).name
                    cells.append(make_image(img_path, max_w=CONTENT_W / len(img_matches) - 6))
                t = Table([cells], colWidths=[CONTENT_W / len(img_matches)] * len(img_matches))
                t.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 3),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                ]))
                story.append(t)

            if caption_text:
                story.append(para(caption_text, 'Caption'))
            else:
                story.append(Spacer(1, 10))
            continue

        if re.match(r'^\d+\.\s', stripped) or stripped.startswith('- '):
            list_items = []
            ordered = bool(re.match(r'^\d+\.\s', stripped))
            while i < n:
                cur = lines[i].strip()
                if ordered and re.match(r'^\d+\.\s', cur):
                    text = re.sub(r'^\d+\.\s', '', cur)
                elif (not ordered) and cur.startswith('- '):
                    text = cur[2:]
                elif cur and not cur.startswith('#') and not cur.startswith('|') and \
                        list_items and (cur.startswith('  ') or (lines[i].startswith(' ') and lines[i].strip())):
                    # continuation line of previous item (indented wrap)
                    list_items[-1] = list_items[-1] + ' ' + cur.strip()
                    i += 1
                    continue
                else:
                    break
                list_items.append(text)
                i += 1
            for idx, t in enumerate(list_items, start=1):
                prefix = f'{idx}.&nbsp;&nbsp;' if ordered else '&bull;&nbsp;&nbsp;'
                story.append(Paragraph(prefix + inline(t), styles['ManualBullet']))
            story.append(Spacer(1, 6))
            continue

        # plain paragraph: gather continuation lines until blank/special
        para_lines = [stripped]
        i += 1
        while i < n and lines[i].strip() and not lines[i].strip().startswith(('#', '|', '```', '-', '!', '---')) \
                and not re.match(r'^\d+\.\s', lines[i].strip()):
            para_lines.append(lines[i].strip())
            i += 1
        story.append(para(' '.join(para_lines), 'Body'))

    return story


# ---------------------------------------------------------------------------
# Page templates (cover / TOC / body) with header+footer on body pages
# ---------------------------------------------------------------------------

def draw_body_furniture(canv: pdfcanvas.Canvas, doc):
    canv.saveState()
    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.6)
    canv.line(MARGIN, PAGE_H - 0.55 * inch, PAGE_W - MARGIN, PAGE_H - 0.55 * inch)
    canv.setFont('Helvetica-Bold', 8.5)
    canv.setFillColor(MUTED)
    canv.drawString(MARGIN, PAGE_H - 0.45 * inch, 'StitchMesh — Complete User Manual')
    canv.line(MARGIN, 0.6 * inch, PAGE_W - MARGIN, 0.6 * inch)
    canv.setFont('Helvetica', 8.5)
    canv.drawRightString(PAGE_W - MARGIN, 0.4 * inch, f'Page {doc.page - 2}')
    canv.drawString(MARGIN, 0.4 * inch, 'Modify, don\'t model.')
    canv.restoreState()


def draw_plain(canv, doc):
    pass


def build():
    md_text = MANUAL_MD.read_text()

    doc = BaseDocTemplate(
        str(OUT_PDF), pagesize=LETTER,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
        title='StitchMesh — Complete User Manual',
        author='StitchMesh Project',
    )

    full_frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id='full')
    body_frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN - 0.15 * inch, id='body')

    doc.addPageTemplates([
        PageTemplate(id='Plain', frames=[full_frame], onPage=draw_plain),
        PageTemplate(id='Body', frames=[body_frame], onPage=draw_body_furniture),
    ])

    story = []

    # ---- Cover page ----
    story.append(Spacer(1, 1.6 * inch))
    hero = ASSETS / '01-empty-state.png'
    story.append(make_image(hero, max_w=4.6 * inch))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph('StitchMesh', styles['CoverTitle']))
    story.append(Paragraph('Complete User Manual', styles['CoverSubtitle']))
    story.append(Paragraph('&ldquo;Modify, don&rsquo;t model.&rdquo;', styles['CoverTagline']))
    story.append(Spacer(1, 0.5 * inch))
    story.append(Paragraph(
        'An offline tool for making localized edits to an existing .stl file — '
        'resize a hole, add a threaded boss, cut a model in two, measure a '
        'clearance — without learning a full CAD package.',
        ParagraphStyle('CoverBody', parent=styles['Body'], alignment=TA_CENTER,
                       fontSize=10.5, textColor=MUTED, leftIndent=40, rightIndent=40),
    ))
    story.append(Spacer(1, 1.0 * inch))
    story.append(Paragraph(f'Generated {datetime.date.today():%B %d, %Y}', styles['CoverMeta']))
    story.append(NextPageTemplate('Plain'))
    story.append(PageBreak())

    # ---- Table of contents ----
    story.append(Paragraph('Table of Contents', styles['TOCHeading']))
    toc = TableOfContents()
    toc.levelStyles = [styles['TOC1'], styles['TOC2']]
    story.append(toc)
    story.append(NextPageTemplate('Body'))
    story.append(PageBreak())

    # ---- Body ----
    story.extend(parse_manual(md_text))

    def after_flowable(flowable):
        if isinstance(flowable, HeadingParagraph):
            text = getattr(flowable, '_toc_text', '')
            level = getattr(flowable, '_toc_level', 0)
            doc.notify('TOCEntry', (level, text, doc.page, flowable._bookmark_key))

    doc.afterFlowable = after_flowable

    doc.multiBuild(story)
    print(f'Wrote {OUT_PDF} ({OUT_PDF.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    build()
