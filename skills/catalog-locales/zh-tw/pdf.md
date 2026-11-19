使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# PDF 處理指南

## 概述

本指南涵蓋使用 Python 程式庫和命令列工具的基本 PDF 處理操作。有關進階功能、JavaScript 庫和詳細範例，請參閱 REFERENCE.md。如果您需要填寫 PDF 表單，請閱讀 FORMS.md 並按照其說明進行操作。

## 快速入門

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python 函式庫

### pypdf - 基本操作

#### 合併 PDF
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### 分割PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### 擷取元數據
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### 旋轉頁面
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - 文字與表格擷取

#### 使用佈局提取文本
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### 提取表
```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

#### 進階表擷取
```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # Check if table is not empty
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine all tables
if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab - 建立 PDF

#### 基本 PDF 創建
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### 建立多頁 PDF
```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

# Add content
title = Paragraph("Report Title", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("This is the body of the report. " * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

# Page 2
story.append(Paragraph("Page 2", styles['Heading1']))
story.append(Paragraph("Content for page 2", styles['Normal']))

# Build PDF
doc.build(story)
```

#### 下標和上標

**重要**：切勿在 ReportLab PDF 中使用 Unicode 下標/上標字元 (₀₁ς₃₄₅₆₇₈₉、⁰¹²³⁴⁵⁶⁷⁸⁹)。內建字體不包含這些字形，導致它們呈現為實心黑框。

相反，在 Paragraph 物件中使用 ReportLab 的 XML 標記：
```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

對於畫布繪製的文字（不是 Paragraph 物件），手動調整字體大小和位置，而不是使用 Unicode 下標/上標。

## 命令列工具

### pdftotext（poppler-utils）
```bash
# Extract text
pdftotext input.pdf output.txt

# Extract text preserving layout
pdftotext -layout input.pdf output.txt

# Extract specific pages
pdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5
```

### qpdf
```bash
# Merge PDFs
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Split pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf --pages . 6-10 -- pages6-10.pdf

# Rotate pages
qpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees

# Remove password
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk（如果有）
```bash
# Merge
pdftk file1.pdf file2.pdf cat output merged.pdf

# Split
pdftk input.pdf burst

# Rotate
pdftk input.pdf rotate 1east output rotated.pdf
```

## 常見任務

### 從掃描的 PDF 中提取文本
```python
# Requires: pip install pytesseract pdf2image
import pytesseract
from pdf2image import convert_from_path

# Convert PDF to images
images = convert_from_path('scanned.pdf')

# OCR each page
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n"
    text += pytesseract.image_to_string(image)
    text += "\n\n"

print(text)
```

### 添加浮水印
```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### 擷取影像
```bash
# Using pdfimages (poppler-utils)
pdfimages -j input.pdf output_prefix

# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.
```

### 密碼保護
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## 快速參考

| 任務 | 最佳工具 | 指令/程式碼 |
|------|-----------|--------------|
| 合併 PDF | pypdf | `writer.add_page(page)` |
| 分割 PDF | pypdf | 每個文件一頁 |
| 擷取文字 | pdfplumber | `page.extract_text()` |
| 提取表 | pdfplumber | `page.extract_tables()` |
| 建立 PDF | reportlab | Canvas 或 Platypus |
| 命令列合併 | qpdf | `qpdf --empty --pages ...` |
| OCR 掃描的 PDF | pytesseract | 先轉換為影像 |
| 填寫 PDF 表單 | pdf-lib 或 pypdf（請參閱 FORMS.md） | 請參閱 FORMS.md |

## 下一步

- 有關 pypdfium2 的高階用法，請參閱 REFERENCE.md
- 有關 JavaScript 函式庫 (pdf-lib)，請參閱 REFERENCE.md
- 如果您需要填寫 PDF 表單，請按照 FORMS.md 中的說明進行操作
- 有關故障排除指南，請參閱 REFERENCE.md
