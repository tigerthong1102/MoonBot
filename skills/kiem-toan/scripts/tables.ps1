function Stop-Audit([string]$code) { throw "AUDIT_$code" }

function Read-XmlDocument($stream) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 8388608
    $reader = [Xml.XmlReader]::Create($stream, $settings)
    try {
        $doc = [Xml.XmlDocument]::new()
        $doc.XmlResolver = $null
        $doc.Load($reader)
        return ,$doc
    } finally { $reader.Dispose() }
}

function Get-XmlPart($zip, [string]$name) {
    $entry = $zip.GetEntry($name)
    if (!$entry) { Stop-Audit 'XLSX_PART' }
    $stream = $entry.Open()
    try { return ,(Read-XmlDocument $stream) } finally { $stream.Dispose() }
}

function Get-XlsxTable($stream, $source) {
    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $true)
    try {
        $expanded = 0L
        $parts = @{}
        if ($zip.Entries.Count -gt 512) { Stop-Audit 'XLSX_LIMIT' }
        foreach ($entry in $zip.Entries) {
            $expanded += $entry.Length
            if ($parts.ContainsKey($entry.FullName) -or $entry.FullName -match 'externalLinks|vbaProject|embeddings|\.\.') { Stop-Audit 'XLSX_CONTENT' }
            $parts[$entry.FullName] = $true
            if ($entry.Length -gt 8388608 -or $expanded -gt 33554432) { Stop-Audit 'XLSX_LIMIT' }
        }
        $book = Get-XmlPart $zip 'xl/workbook.xml'
        $sheets = @($book.SelectNodes("/*[local-name()='workbook']/*[local-name()='sheets']/*[local-name()='sheet']") | Where-Object {
            $_.GetAttribute('name') -ceq $source.sheet -and $_.GetAttribute('state') -in @('', 'visible')
        })
        if (!$source.sheet) {
            $visible=@($book.SelectNodes("/*[local-name()='workbook']/*[local-name()='sheets']/*[local-name()='sheet']") | Where-Object { $_.GetAttribute('state') -in @('', 'visible') } | ForEach-Object { $_.GetAttribute('name') })
            return @{sheets=$visible; metadataOnly=$true}
        }
        $props=$book.SelectSingleNode("/*/*[local-name()='workbookPr']")
        $epoch1904=$props -and $props.GetAttribute('date1904') -in @('1','true')
        if ($sheets.Count -ne 1) { Stop-Audit 'CHOOSE_VISIBLE_SHEET' }
        $id = $sheets[0].GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $rels = Get-XmlPart $zip 'xl/_rels/workbook.xml.rels'
        $ref = @($rels.DocumentElement.ChildNodes | Where-Object {
            $_.GetAttribute('Id') -ceq $id -and $_.GetAttribute('Type').EndsWith('/worksheet') -and !$_.GetAttribute('TargetMode')
        })
        if ($ref.Count -ne 1) { Stop-Audit 'XLSX_RELATION' }
        $target = $ref[0].GetAttribute('Target') -creplace '^/xl/', ''
        if ($target -cnotmatch '^worksheets/[A-Za-z0-9_.-]+\.xml$') { Stop-Audit 'XLSX_RELATION' }
        $sheet = Get-XmlPart $zip ("xl/" + $target)
        $strings = [Collections.Generic.List[string]]::new()
        if ($zip.GetEntry('xl/sharedStrings.xml')) {
            $ss = Get-XmlPart $zip 'xl/sharedStrings.xml'
            foreach ($si in $ss.DocumentElement.ChildNodes) {
                $strings.Add(($si.SelectNodes(".//*[local-name()='t' and not(ancestor::*[local-name()='rPh'])]") | ForEach-Object InnerText) -join '')
            }
        }
        $headerRow = if ($source.headerRow) { [int]$source.headerRow } else { 1 }
        foreach ($merge in $sheet.SelectNodes("/*/*[local-name()='mergeCells']/*[local-name()='mergeCell']")) {
            if ($merge.GetAttribute('ref') -cnotmatch '^[A-Z]+([0-9]+):[A-Z]+([0-9]+)$') { Stop-Audit 'MERGED_DATA' }
            if ([int]$Matches[2] -ge $headerRow -and (!$source.lastRow -or [int]$Matches[1] -le [int]$source.lastRow)) { Stop-Audit 'MERGED_DATA' }
        }
        $names = @{}
        $data = [Collections.Generic.List[object]]::new()
        $seen = 0
        foreach ($row in $sheet.SelectNodes("/*/*[local-name()='sheetData']/*[local-name()='row']")) {
            $n = [int]$row.GetAttribute('r')
            if ($n -le $seen) { Stop-Audit 'XLSX_ROW_ORDER' }
            $seen = $n
            if ($n -lt $headerRow -or ($source.lastRow -and $n -gt [int]$source.lastRow)) { continue }
            $values = @{}
            foreach ($cell in $row.SelectNodes("./*[local-name()='c']")) {
                $address = $cell.GetAttribute('r')
                if ($address -cnotmatch '^([A-Z]{1,3})([0-9]+)$' -or [int]$Matches[2] -ne $n) { Stop-Audit 'XLSX_ADDRESS' }
                $col = $Matches[1]
                if ($cell.SelectSingleNode("./*[local-name()='f']")) { Stop-Audit 'FORMULA_EXPORT_VALUES' }
                $v = $cell.SelectSingleNode("./*[local-name()='v']")
                $value = if ($v) { $v.InnerText } else { '' }
                $kind = $cell.GetAttribute('t')
                if ($kind -notin @('s','inlineStr','n','','str','d','e')) { Stop-Audit 'XLSX_CELL_TYPE' }
                switch ($kind) {
                    's' { if ($value -notmatch '^\d+$' -or [long]$value -ge $strings.Count) { Stop-Audit 'XLSX_STRING' }; $value = $strings[[int]$value] }
                    'inlineStr' { $value = ($cell.SelectNodes(".//*[local-name()='t' and not(ancestor::*[local-name()='rPh'])]") | ForEach-Object InnerText) -join '' }
                    'e' { Stop-Audit 'XLSX_ERROR_CELL' }
                }
                if ($value -ceq '') { continue }
                if ($n -eq $headerRow) {
                    if ($names.ContainsValue($value) -or $names.ContainsKey($col) -or $names.psbase.Values -contains $value) { Stop-Audit 'AMBIGUOUS_HEADER' }
                    $names[$col] = $value
                } else {
                    if (!$names.ContainsKey($col)) { Stop-Audit 'XLSX_HEADER_WIDTH' }
                    $name = $names[$col]
                    if ($values.ContainsKey($name)) { Stop-Audit 'XLSX_ADDRESS' }
                    $values[$name] = @{text=$value; numeric=($kind -in @('', 'n'))}
                }
            }
            if ($n -gt $headerRow -and $values.psbase.Count) { $data.Add(@{line=$n; cells=$values}) }
            if ($data.Count -gt 20000) { Stop-Audit 'ROW_LIMIT' }
        }
        if (!$names.psbase.Count) { Stop-Audit 'MISSING_HEADER' }
        return @{rows=$data; headers=@($names.psbase.Values); sheet=$source.sheet; epoch1904=$epoch1904}
    } finally { $zip.Dispose() }
}

function Get-XmlTable($stream, $source) {
    if (!$source.recordPath) {
        $doc=Read-XmlDocument $stream
        $paths=@{}
        foreach ($node in $doc.SelectNodes('//*')) {
            $parts=[Collections.Generic.List[string]]::new()
            $cur=$node
            while ($cur.NodeType -eq 'Element') {
                if ($parts.Count -ge 32) { Stop-Audit 'XML_DEPTH' }
                $parts.Add($cur.LocalName); $cur=$cur.ParentNode
            }
            $parts.Reverse()
            $key='/'+($parts -join '/')
            $paths[$key]=1+$paths[$key]
            if ($paths.Count -gt 1000) { Stop-Audit 'XML_PATH_LIMIT' }
        }
        return @{paths=$paths; rootNamespace=$doc.DocumentElement.NamespaceURI; metadataOnly=$true}
    }
    if ($source.recordPath -cnotmatch '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$') { Stop-Audit 'XML_RECORD_PATH' }
    $doc = Read-XmlDocument $stream
    $uri = [string]$source.namespace
    $ns = [Xml.XmlNamespaceManager]::new($doc.NameTable)
    $prefix = ''
    if ($uri) { $ns.AddNamespace('r', $uri); $prefix = 'r:' }
    $path = '/' + (($source.recordPath.Substring(1).Split('/') | ForEach-Object { $prefix + $_ }) -join '/')
    $records = $doc.SelectNodes($path, $ns)
    if (!$records.Count) { Stop-Audit 'XML_RECORD_PATH_EMPTY' }
    if ($records.Count -gt 20000) { Stop-Audit 'ROW_LIMIT' }
    $data = [Collections.Generic.List[object]]::new()
    $headers = @{}
    foreach ($record in $records) {
        $cells = @{}
        if ($source.fields) {
            foreach ($f in $source.fields.PSObject.Properties) {
                $field=[string]$f.Value
                if ($field -cnotmatch '^[A-Za-z_][A-Za-z0-9_.-]*(/[A-Za-z_][A-Za-z0-9_.-]*)*$') { Stop-Audit 'XML_FIELD_PATH' }
                $segments=($field.Split('/') | ForEach-Object { $prefix+$_ }) -join '/'
                $nodes=$record.SelectNodes($segments,$ns)
                if ($nodes.Count -gt 1 -or ($nodes.Count -and $nodes[0].SelectNodes('./*').Count)) { Stop-Audit 'XML_AMBIGUOUS_FIELD' }
                if ($nodes.Count) { $cells[$field]=@{text=$nodes[0].InnerText; numeric=$false}; $headers[$field]=$true }
            }
        } else { foreach ($node in $record.ChildNodes) {
            if ($node.NodeType -ne 'Element') { continue }
            if ($node.NamespaceURI -cne $uri -or $node.SelectNodes('./*').Count -gt 0) { Stop-Audit 'XML_NEEDS_FLAT_RECORD_MAPPING' }
            if ($cells.ContainsKey($node.LocalName)) { Stop-Audit 'AMBIGUOUS_HEADER' }
            $headers[$node.LocalName] = $true
            $cells[$node.LocalName] = @{text=$node.InnerText; numeric=$false}
        }
        }
        $data.Add(@{line=$data.Count+1; cells=$cells})
    }
    return @{rows=$data; headers=@($headers.psbase.Keys); recordPath=$source.recordPath}
}

function Read-AuditTable($source) {
    $path = Get-AuditLocalPath $source.path
    $stream = [IO.File]::Open($path, 'Open', 'Read', 'Read')
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt 8388608) { Stop-Audit 'FILE_SIZE' }
        $algo = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($algo.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $algo.Dispose() }
        $stream.Position = 0
        switch ([IO.Path]::GetExtension($path)) {
            '.xlsx' { $table = Get-XlsxTable $stream $source }
            '.xml' { $table = Get-XmlTable $stream $source }
            default { Stop-Audit 'UNSUPPORTED_FILE' }
        }
        $table.sha256 = $digest
        return $table
    } finally { $stream.Dispose() }
}
