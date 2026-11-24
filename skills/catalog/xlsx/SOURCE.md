# Source and modifications

Upstream directory https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/xlsx

Upstream license https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/xlsx/LICENSE.txt

StartupBot adapted SKILL.md for configured document tools and local dependencies. StartupBot also modified scripts/recalc.py to invoke the locally installed soffice directly with an isolated profile and report calculated array results that require new cells. Other included upstream files retain their original contents.

Excluded third-party OOXML schemas and their dependent helpers. Retained the independent recalc helper.

Included upstream notices: THIRD_PARTY_NOTICES.md.

## Excluded upstream files

- scripts/office/helpers/__init__.py
- scripts/office/helpers/pptx_chart.py
- scripts/office/helpers/pptx_slide.py
- scripts/office/helpers/pptx_theme.py
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-chart.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-chartDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-diagram.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-lockedCanvas.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-main.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-picture.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-spreadsheetDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/dml-wordprocessingDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/pml.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-additionalCharacteristics.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-bibliography.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-commonSimpleTypes.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-customXmlDataProperties.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-customXmlSchemaProperties.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-documentPropertiesCustom.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-documentPropertiesExtended.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-documentPropertiesVariantTypes.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-math.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/shared-relationshipReference.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/sml.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/vml-main.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/vml-officeDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/vml-presentationDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/vml-spreadsheetDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/vml-wordprocessingDrawing.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/wml.xsd
- scripts/office/schemas/ISO-IEC29500-4_2016/xml.xsd
- scripts/office/schemas/ecma/fouth-edition/opc-contentTypes.xsd
- scripts/office/schemas/ecma/fouth-edition/opc-coreProperties.xsd
- scripts/office/schemas/ecma/fouth-edition/opc-digSig.xsd
- scripts/office/schemas/ecma/fouth-edition/opc-relationships.xsd
- scripts/office/schemas/mce/mc.xsd
- scripts/office/schemas/microsoft/wml-2010.xsd
- scripts/office/schemas/microsoft/wml-2012.xsd
- scripts/office/schemas/microsoft/wml-2018.xsd
- scripts/office/schemas/microsoft/wml-cex-2018.xsd
- scripts/office/schemas/microsoft/wml-cid-2016.xsd
- scripts/office/schemas/microsoft/wml-sdtdatahash-2020.xsd
- scripts/office/schemas/microsoft/wml-symex-2015.xsd
- scripts/office/soffice.py
- scripts/office/validate.py
- scripts/office/validators/__init__.py
- scripts/office/validators/base.py
- scripts/office/validators/docx.py
- scripts/office/validators/pptx.py
- scripts/office/validators/redlining.py
